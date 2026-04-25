namespace TacTacToe.Services;

// ── Fox and Hounds ────────────────────────────────────────────────────────────
// Standard rules:
//   • 8×8 board, dark squares only (32 playable squares)
//   • Fox starts at any dark square on row 0 (the top row, from white's view)
//   • 4 Hounds start on the four dark squares of row 7 (bottom row)
//   • Hounds move diagonally forward only (increasing row index toward row 0)
//   • Fox moves diagonally in any direction (4 choices)
//   • Fox wins if it reaches row 7 (the hound back rank) or if the Hounds have
//     no legal moves remaining
//   • Hounds win if they surround the Fox so it has no legal moves

public class FoxAndHoundsRoom
{
    public string Id { get; set; } = "";
    public string HostConnectionId { get; set; } = "";
    public string HostName { get; set; } = "";
    public List<FoxAndHoundsPlayer> Players { get; set; } = [];
    public FoxAndHoundsSettings Settings { get; set; } = new();
    public bool Started { get; set; }
    public bool IsOver { get; set; }
    public bool IsSinglePlayer { get; set; }
    public long StartedAtMs { get; set; }

    // Game state
    public int FoxRow { get; set; }
    public int FoxCol { get; set; }
    public List<FoxAndHoundsHound> Hounds { get; set; } = [];
    public int CurrentPlayerIndex { get; set; }   // 0 = Fox, 1 = Hounds
    public string? WinnerRole { get; set; }        // "Fox" or "Hounds"
    public string? WinnerName { get; set; }
    public int MoveCount { get; set; }
    public FoxAndHoundsLastMove? LastMove { get; set; }

    // Role assignment (index in Players)
    public int FoxPlayerIndex { get; set; } = 0;
    public int HoundsPlayerIndex { get; set; } = 1;
}

public class FoxAndHoundsLastMove
{
    public string Role { get; set; } = "";       // "Fox" or "Hounds"
    public int FromRow { get; set; }
    public int FromCol { get; set; }
    public int ToRow { get; set; }
    public int ToCol { get; set; }
    public int HoundIndex { get; set; } = -1;   // which hound moved (-1 for fox)
}

public class FoxAndHoundsSettings
{
    public string RoomName { get; set; } = "Fox and Hounds";
    public int MaxPlayers { get; set; } = 2;
    public bool FillWithBotsOnStart { get; set; }
    public string BotDifficulty { get; set; } = "medium";  // "easy" | "medium" | "hard"
}

public class FoxAndHoundsPlayer
{
    public string ConnectionId { get; set; } = "";
    public string Name { get; set; } = "";
    public bool Connected { get; set; } = true;
    public bool IsBot { get; set; }
    public string Role { get; set; } = "";   // "Fox" or "Hounds"
}

public class FoxAndHoundsHound
{
    public int Index { get; set; }   // 0–3
    public int Row { get; set; }
    public int Col { get; set; }
}

public class FoxAndHoundsMove
{
    public string Role { get; set; } = "";
    public int FromRow { get; set; }
    public int FromCol { get; set; }
    public int ToRow { get; set; }
    public int ToCol { get; set; }
    public int HoundIndex { get; set; } = -1;
}

public class FoxAndHoundsHint
{
    public bool HintAvailable { get; set; }
    public string Description { get; set; } = "";
    public FoxAndHoundsMove? Move { get; set; }
}

// ── Engine ────────────────────────────────────────────────────────────────────
public static class FoxAndHoundsEngine
{
    // Fox starts on the dark square nearest the center-left of row 0.
    // Hounds start on all 4 dark squares of row 7.
    // Dark squares: (row + col) % 2 == 0  (matching a standard checkers setup
    //               where the top-left corner is dark).

    private static bool IsDark(int row, int col) => (row + col) % 2 == 0;

    public static void StartGame(FoxAndHoundsRoom room)
    {
        // Fox at col 4, row 0 (a dark center-ish square)
        room.FoxRow = 0;
        room.FoxCol = 4;

        // Four hounds on the dark squares of row 7: cols 1, 3, 5, 7
        // Dark squares satisfy (row + col) % 2 == 0, so for row 7 the dark cols are ODD.
        room.Hounds =
        [
            new FoxAndHoundsHound { Index = 0, Row = 7, Col = 1 },
            new FoxAndHoundsHound { Index = 1, Row = 7, Col = 3 },
            new FoxAndHoundsHound { Index = 2, Row = 7, Col = 5 },
            new FoxAndHoundsHound { Index = 3, Row = 7, Col = 7 },
        ];

        // Randomly assign roles to players
        var rng = Random.Shared;
        bool humanIsFox = rng.Next(2) == 0;
        var humans = room.Players.Where(p => !p.IsBot).ToList();
        var bots   = room.Players.Where(p => p.IsBot).ToList();

        if (room.IsSinglePlayer)
        {
            // Human vs 1 bot
            var human = humans.First();
            var bot   = bots.First();
            if (humanIsFox)
            {
                human.Role = "Fox";
                bot.Role   = "Hounds";
                room.FoxPlayerIndex    = room.Players.IndexOf(human);
                room.HoundsPlayerIndex = room.Players.IndexOf(bot);
            }
            else
            {
                human.Role = "Hounds";
                bot.Role   = "Fox";
                room.FoxPlayerIndex    = room.Players.IndexOf(bot);
                room.HoundsPlayerIndex = room.Players.IndexOf(human);
            }
        }
        else
        {
            // 2-human game — host gets Fox (or random)
            room.Players[0].Role = "Fox";
            room.Players[1].Role = "Hounds";
            room.FoxPlayerIndex    = 0;
            room.HoundsPlayerIndex = 1;
        }

        room.CurrentPlayerIndex = room.FoxPlayerIndex;  // Fox always moves first
        room.MoveCount = 0;
        room.StartedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    }

    // ── Legal move generation ──────────────────────────────────────────────

    public static List<FoxAndHoundsMove> GetFoxMoves(FoxAndHoundsRoom room)
    {
        var occupied = OccupiedSquares(room);
        var moves = new List<FoxAndHoundsMove>();
        int[] dc = [-1, 1];
        int[] dr = [-1, 1];  // Fox can move in all 4 diagonal directions
        foreach (var drow in dr)
        foreach (var dcol in dc)
        {
            int nr = room.FoxRow + drow;
            int nc = room.FoxCol + dcol;
            if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;
            if (!IsDark(nr, nc)) continue;
            if (occupied.Contains((nr, nc))) continue;
            moves.Add(new FoxAndHoundsMove
            {
                Role     = "Fox",
                FromRow  = room.FoxRow,
                FromCol  = room.FoxCol,
                ToRow    = nr,
                ToCol    = nc
            });
        }
        return moves;
    }

    public static List<FoxAndHoundsMove> GetHoundMoves(FoxAndHoundsRoom room)
    {
        var occupied = OccupiedSquares(room);
        var moves = new List<FoxAndHoundsMove>();
        int[] dc = [-1, 1];
        foreach (var h in room.Hounds)
        foreach (var dcol in dc)
        {
            // Hounds only move forward: decreasing row (toward row 0)
            int nr = h.Row - 1;
            int nc = h.Col + dcol;
            if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;
            if (!IsDark(nr, nc)) continue;
            if (occupied.Contains((nr, nc))) continue;
            moves.Add(new FoxAndHoundsMove
            {
                Role       = "Hounds",
                FromRow    = h.Row,
                FromCol    = h.Col,
                ToRow      = nr,
                ToCol      = nc,
                HoundIndex = h.Index
            });
        }
        return moves;
    }

    private static HashSet<(int, int)> OccupiedSquares(FoxAndHoundsRoom room)
    {
        var set = new HashSet<(int, int)> { (room.FoxRow, room.FoxCol) };
        foreach (var h in room.Hounds) set.Add((h.Row, h.Col));
        return set;
    }

    // ── Apply move ────────────────────────────────────────────────────────

    public static bool TryMove(FoxAndHoundsRoom room, FoxAndHoundsMove move)
    {
        if (move.Role == "Fox")
        {
            var legal = GetFoxMoves(room);
            if (!legal.Any(m => m.ToRow == move.ToRow && m.ToCol == move.ToCol))
                return false;
            room.LastMove = new FoxAndHoundsLastMove
            {
                Role = "Fox", FromRow = room.FoxRow, FromCol = room.FoxCol,
                ToRow = move.ToRow, ToCol = move.ToCol, HoundIndex = -1
            };
            room.FoxRow = move.ToRow;
            room.FoxCol = move.ToCol;
        }
        else
        {
            var legal = GetHoundMoves(room);
            var match = legal.FirstOrDefault(m =>
                m.HoundIndex == move.HoundIndex &&
                m.ToRow == move.ToRow && m.ToCol == move.ToCol);
            if (match == null) return false;

            var hound = room.Hounds.First(h => h.Index == move.HoundIndex);
            room.LastMove = new FoxAndHoundsLastMove
            {
                Role = "Hounds", FromRow = hound.Row, FromCol = hound.Col,
                ToRow = move.ToRow, ToCol = move.ToCol, HoundIndex = move.HoundIndex
            };
            hound.Row = move.ToRow;
            hound.Col = move.ToCol;
        }

        room.MoveCount++;
        return true;
    }

    // ── Win detection ──────────────────────────────────────────────────────

    public static void EvaluateWinner(FoxAndHoundsRoom room)
    {
        // Fox wins if it reaches the hounds' back rank (row 7)
        if (room.FoxRow == 7)
        {
            room.IsOver = true;
            room.WinnerRole = "Fox";
            return;
        }

        // Fox is trapped — Hounds win
        if (GetFoxMoves(room).Count == 0)
        {
            room.IsOver = true;
            room.WinnerRole = "Hounds";
            return;
        }

        // Hounds are blocked (extremely rare, but counts as Fox win)
        if (GetHoundMoves(room).Count == 0)
        {
            room.IsOver = true;
            room.WinnerRole = "Fox";
        }
    }

    // ── Scoring ────────────────────────────────────────────────────────────
    // Fox score: 10 × row reached + 100 win bonus.
    // Hounds score: 10 × (7 − fox row) + total move count + 100 win bonus.

    public static int ScoreForFox(FoxAndHoundsRoom room)
    {
        int score = room.FoxRow * 10;
        if (room.WinnerRole == "Fox") score += 100;
        return score;
    }

    public static int ScoreForHounds(FoxAndHoundsRoom room)
    {
        int score = (7 - room.FoxRow) * 10 + room.MoveCount;
        if (room.WinnerRole == "Hounds") score += 100;
        return score;
    }

    // ── Bot AI ─────────────────────────────────────────────────────────────
    // difficulty: "easy" | "medium" | "hard"

    public static FoxAndHoundsMove? ChooseBotMove(FoxAndHoundsRoom room, string botRole, string difficulty = "medium")
    {
        return difficulty switch
        {
            "easy" => ChooseBotMoveEasy(room, botRole),
            "hard" => ChooseBotMoveHard(room, botRole),
            _      => ChooseBotMoveMedium(room, botRole)
        };
    }

    // Easy: purely random legal move
    private static FoxAndHoundsMove? ChooseBotMoveEasy(FoxAndHoundsRoom room, string botRole)
    {
        var moves = botRole == "Fox" ? GetFoxMoves(room) : GetHoundMoves(room);
        if (moves.Count == 0) return null;
        return moves[Random.Shared.Next(moves.Count)];
    }

    // Medium: single-ply greedy heuristic (original logic)
    private static FoxAndHoundsMove? ChooseBotMoveMedium(FoxAndHoundsRoom room, string botRole)
    {
        if (botRole == "Fox")
        {
            var moves = GetFoxMoves(room);
            if (moves.Count == 0) return null;
            // Prefer moves that advance toward row 7
            var adv = moves.Where(m => m.ToRow > m.FromRow).ToList();
            var pool = adv.Count > 0 ? adv : moves;
            return pool[Random.Shared.Next(pool.Count)];
        }
        else
        {
            var moves = GetHoundMoves(room);
            if (moves.Count == 0) return null;
            // Prefer moves that minimise Fox's legal move count
            FoxAndHoundsMove? best = null;
            int bestFreedom = int.MaxValue;
            foreach (var m in moves)
            {
                var hound = room.Hounds.First(h => h.Index == m.HoundIndex);
                int savedRow = hound.Row, savedCol = hound.Col;
                hound.Row = m.ToRow; hound.Col = m.ToCol;
                int freedom = GetFoxMoves(room).Count;
                hound.Row = savedRow; hound.Col = savedCol;
                if (freedom < bestFreedom) { bestFreedom = freedom; best = m; }
            }
            return best ?? moves[Random.Shared.Next(moves.Count)];
        }
    }

    // Hard: minimax with alpha-beta pruning (depth 8)
    // Positive score = good for Hounds; negative = good for Fox.
    private const int HardSearchDepth = 8;

    private static FoxAndHoundsMove? ChooseBotMoveHard(FoxAndHoundsRoom room, string botRole)
    {
        // Snapshot mutable state
        var snap = Snapshot(room);
        bool houndsToMove = botRole == "Hounds";

        FoxAndHoundsMove? bestMove = null;
        int alpha = int.MinValue, beta = int.MaxValue;

        if (houndsToMove)
        {
            int bestScore = int.MinValue;
            foreach (var m in GetHoundMoves(room))
            {
                ApplyHoundMove(room, m);
                int score = Minimax(room, HardSearchDepth - 1, alpha, beta, false);
                RestoreSnapshot(room, snap);
                if (score > bestScore) { bestScore = score; bestMove = m; }
                if (bestScore > alpha) alpha = bestScore;
                if (beta <= alpha) break;
            }
        }
        else
        {
            int bestScore = int.MaxValue;
            foreach (var m in GetFoxMoves(room))
            {
                ApplyFoxMove(room, m);
                int score = Minimax(room, HardSearchDepth - 1, alpha, beta, true);
                RestoreSnapshot(room, snap);
                if (score < bestScore) { bestScore = score; bestMove = m; }
                if (bestScore < beta) beta = bestScore;
                if (beta <= alpha) break;
            }
        }
        return bestMove ?? (houndsToMove ? ChooseBotMoveMedium(room, "Hounds") : ChooseBotMoveMedium(room, "Fox"));
    }

    // Minimax: maximizing = Hounds, minimizing = Fox
    private static int Minimax(FoxAndHoundsRoom room, int depth, int alpha, int beta, bool houndsToMove)
    {
        // Terminal: Fox reaches row 7 → Fox wins (very negative for Hounds)
        if (room.FoxRow == 7) return -10000;

        var foxMoves   = GetFoxMoves(room);
        var houndMoves = GetHoundMoves(room);

        // Terminal: Fox trapped → Hounds win (very positive)
        if (foxMoves.Count == 0) return 10000;
        // Terminal: Hounds have no moves → Fox wins (very negative for Hounds)
        if (houndMoves.Count == 0) return -10000;

        if (depth == 0) return Evaluate(room);

        var snap = Snapshot(room);

        if (houndsToMove)
        {
            int value = int.MinValue;
            foreach (var m in houndMoves)
            {
                ApplyHoundMove(room, m);
                int v = Minimax(room, depth - 1, alpha, beta, false);
                RestoreSnapshot(room, snap);
                if (v > value) value = v;
                if (value > alpha) alpha = value;
                if (beta <= alpha) break;
            }
            return value;
        }
        else
        {
            int value = int.MaxValue;
            foreach (var m in foxMoves)
            {
                ApplyFoxMove(room, m);
                int v = Minimax(room, depth - 1, alpha, beta, true);
                RestoreSnapshot(room, snap);
                if (v < value) value = v;
                if (value < beta) beta = value;
                if (beta <= alpha) break;
            }
            return value;
        }
    }

    // Heuristic score (positive = Hounds winning, negative = Fox winning)
    private static int Evaluate(FoxAndHoundsRoom room)
    {
        int foxMobility   = GetFoxMoves(room).Count;
        int houndMobility = GetHoundMoves(room).Count;

        // How many hounds are ahead of (closer to row 0 than) the fox
        int houndsAhead = room.Hounds.Count(h => h.Row < room.FoxRow);

        // How far the fox has advanced (higher row = closer to goal at row 7)
        int foxAdvance = room.FoxRow;

        // Hounds want: low fox mobility, many hounds ahead of fox, fox far from goal
        // Fox wants: high mobility, fewer hounds ahead, closer to row 7
        return  (4 - foxMobility) * 15       // restrict Fox
              + houndsAhead       * 10       // hounds cutting off Fox's path back
              - foxAdvance        * 8        // penalise Fox advancing
              + houndMobility     * 2;       // some hound mobility is good
    }

    // Lightweight snapshot / restore (only mutable positions, not full deep clone)
    private record FahSnap(int FoxRow, int FoxCol, (int Row, int Col)[] Hounds);

    private static FahSnap Snapshot(FoxAndHoundsRoom room) =>
        new(room.FoxRow, room.FoxCol,
            room.Hounds.Select(h => (h.Row, h.Col)).ToArray());

    private static void RestoreSnapshot(FoxAndHoundsRoom room, FahSnap s)
    {
        room.FoxRow = s.FoxRow;
        room.FoxCol = s.FoxCol;
        for (int i = 0; i < room.Hounds.Count; i++)
        {
            room.Hounds[i].Row = s.Hounds[i].Row;
            room.Hounds[i].Col = s.Hounds[i].Col;
        }
    }

    private static void ApplyFoxMove(FoxAndHoundsRoom room, FoxAndHoundsMove m)
    {
        room.FoxRow = m.ToRow;
        room.FoxCol = m.ToCol;
    }

    private static void ApplyHoundMove(FoxAndHoundsRoom room, FoxAndHoundsMove m)
    {
        var h = room.Hounds.First(h => h.Index == m.HoundIndex);
        h.Row = m.ToRow;
        h.Col = m.ToCol;
    }

    // ── Hint ───────────────────────────────────────────────────────────────

    public static FoxAndHoundsHint ComputeHint(FoxAndHoundsRoom room, string role)
    {
        if (role == "Fox")
        {
            var moves = GetFoxMoves(room);
            if (moves.Count == 0)
                return new FoxAndHoundsHint { HintAvailable = false, Description = "Fox has no legal moves!" };
            // Use medium logic: prefer advancing
            var adv = moves.Where(m => m.ToRow > m.FromRow).ToList();
            var m = adv.Count > 0 ? adv[0] : moves[0];
            return new FoxAndHoundsHint
            {
                HintAvailable = true,
                Description = $"Move Fox from ({m.FromRow},{m.FromCol}) → ({m.ToRow},{m.ToCol})",
                Move = m
            };
        }
        else
        {
            var moves = GetHoundMoves(room);
            if (moves.Count == 0)
                return new FoxAndHoundsHint { HintAvailable = false, Description = "Hounds have no legal moves!" };
            // Use medium (greedy) logic for hints regardless of difficulty
            var best = ChooseBotMoveMedium(room, "Hounds") ?? moves[0];
            return new FoxAndHoundsHint
            {
                HintAvailable = true,
                Description = $"Move Hound #{best.HoundIndex + 1} from ({best.FromRow},{best.FromCol}) → ({best.ToRow},{best.ToCol})",
                Move = best
            };
        }
    }
}
