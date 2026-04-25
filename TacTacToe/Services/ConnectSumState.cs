namespace TacTacToe.Services;

public class ConnectSumRoom
{
    public string Id { get; set; } = "";
    public string HostConnectionId { get; set; } = "";
    public string HostName { get; set; } = "";
    public List<ConnectSumPlayer> Players { get; set; } = [];
    public ConnectSumSettings Settings { get; set; } = new();
    public bool Started { get; set; }
    public bool IsOver { get; set; }
    public bool IsSinglePlayer { get; set; }
    public string? WinnerName { get; set; }
    // Board: [row][col], 0=empty, 1=player1, 2=player2
    public int[][] Board { get; set; } = [];
    public int Rows { get; set; }
    public int Cols { get; set; }
    public int ConnectN { get; set; } = 4;
    public int CurrentPlayerIndex { get; set; }
    public int[]? WinLine { get; set; } // [r0,c0, r1,c1, r2,c2, r3,c3, ...] pairs
    public long StartedAtMs { get; set; }
    public bool SessionsSaved { get; set; }
    public bool IsDraw { get; set; }
}

public class ConnectSumSettings
{
    public string RoomName { get; set; } = "Connect a Sum";
    public int MaxPlayers { get; set; } = 2;
    public int ConnectN { get; set; } = 4; // 4, 5, or 6
}

public class ConnectSumPlayer
{
    public string ConnectionId { get; set; } = "";
    public string Name { get; set; } = "";
    public bool Connected { get; set; } = true;
    public bool IsBot { get; set; }
    public string AiDifficulty { get; set; } = "regular"; // "regular" or "hard"
    public int Wins { get; set; }
}

public static class ConnectSumEngine
{
    public static (int Rows, int Cols) BoardSize(int connectN) => connectN switch
    {
        5 => (7, 8),
        6 => (8, 9),
        _ => (6, 7)
    };

    public static int[][] CreateBoard(int rows, int cols)
    {
        var b = new int[rows][];
        for (int r = 0; r < rows; r++) b[r] = new int[cols];
        return b;
    }

    public static void StartGame(ConnectSumRoom room)
    {
        room.Started = true;
        room.IsOver = false;
        room.IsDraw = false;
        room.WinnerName = null;
        room.WinLine = null;
        room.SessionsSaved = false;
        room.ConnectN = room.Settings.ConnectN;
        (room.Rows, room.Cols) = BoardSize(room.ConnectN);
        room.Board = CreateBoard(room.Rows, room.Cols);
        room.CurrentPlayerIndex = 0;
        room.StartedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    }

    // Returns the row where the disc lands, or -1 if column is full
    public static int DropDisc(ConnectSumRoom room, int col)
    {
        if (col < 0 || col >= room.Cols) return -1;
        for (int r = room.Rows - 1; r >= 0; r--)
        {
            if (room.Board[r][col] == 0)
            {
                room.Board[r][col] = room.CurrentPlayerIndex + 1;
                return r;
            }
        }
        return -1;
    }

    public static bool CheckWin(ConnectSumRoom room, int row, int col, int player)
    {
        int n = room.ConnectN;
        int[][] dirs = [[0,1],[1,0],[1,1],[1,-1]];
        foreach (var d in dirs)
        {
            var line = new List<(int,int)>();
            line.Add((row, col));
            // forward
            for (int s = 1; s < n; s++)
            {
                int r2 = row + d[0]*s, c2 = col + d[1]*s;
                if (r2 < 0 || r2 >= room.Rows || c2 < 0 || c2 >= room.Cols || room.Board[r2][c2] != player) break;
                line.Add((r2, c2));
            }
            // backward
            for (int s = 1; s < n; s++)
            {
                int r2 = row - d[0]*s, c2 = col - d[1]*s;
                if (r2 < 0 || r2 >= room.Rows || c2 < 0 || c2 >= room.Cols || room.Board[r2][c2] != player) break;
                line.Add((r2, c2));
            }
            if (line.Count >= n)
            {
                room.WinLine = line.Take(n).SelectMany(p => new[] { p.Item1, p.Item2 }).ToArray();
                return true;
            }
        }
        return false;
    }

    public static bool IsBoardFull(ConnectSumRoom room)
    {
        for (int c = 0; c < room.Cols; c++)
            if (room.Board[0][c] == 0) return false;
        return true;
    }

    public static List<int> GetValidCols(ConnectSumRoom room)
    {
        var cols = new List<int>();
        for (int c = 0; c < room.Cols; c++)
            if (room.Board[0][c] == 0) cols.Add(c);
        return cols;
    }

    // Simple bot AI
    public static int BotMove(ConnectSumRoom room, int botPlayerIndex, string difficulty)
    {
        var valid = GetValidCols(room);
        if (valid.Count == 0) return -1;

        int botDisc = botPlayerIndex + 1;
        int humanDisc = botDisc == 1 ? 2 : 1;

        if (difficulty == "regular")
        {
            // Try to win
            foreach (int c in valid)
            {
                int row = SimulateDrop(room, c);
                if (row >= 0)
                {
                    var copy = CloneBoard(room);
                    copy[row][c] = botDisc;
                    if (SimulateWin(room, copy, row, c, botDisc)) return c;
                }
            }
            // Block opponent
            foreach (int c in valid)
            {
                int row = SimulateDrop(room, c);
                if (row >= 0)
                {
                    var copy = CloneBoard(room);
                    copy[row][c] = humanDisc;
                    if (SimulateWin(room, copy, row, c, humanDisc)) return c;
                }
            }
            // Center preference
            int center = room.Cols / 2;
            if (valid.Contains(center)) return center;
            return valid[Random.Shared.Next(valid.Count)];
        }
        else // hard: minimax depth 6
        {
            int bestCol = valid[0];
            int bestScore = int.MinValue;
            foreach (int c in valid)
            {
                int row = SimulateDrop(room, c);
                if (row < 0) continue;
                var copy = CloneBoard(room);
                copy[row][c] = botDisc;
                bool won = SimulateWin(room, copy, row, c, botDisc);
                if (won) return c; // immediate win
                int score = Minimax(room, copy, 5, false, int.MinValue, int.MaxValue, botDisc, humanDisc);
                if (score > bestScore) { bestScore = score; bestCol = c; }
            }
            return bestCol;
        }
    }

    private static int Minimax(ConnectSumRoom room, int[][] board, int depth, bool isMax,
        int alpha, int beta, int maxDisc, int minDisc)
    {
        if (depth == 0) return ScoreBoard(room, board, maxDisc, minDisc);
        var validCols = new List<int>();
        for (int c = 0; c < room.Cols; c++) if (board[0][c] == 0) validCols.Add(c);
        if (validCols.Count == 0) return 0;

        int disc = isMax ? maxDisc : minDisc;

        if (isMax)
        {
            int best = int.MinValue;
            foreach (int c in validCols)
            {
                int row = GetDropRow(board, room.Rows, c);
                if (row < 0) continue;
                var copy = CloneBoard2(board, room.Rows, room.Cols);
                copy[row][c] = disc;
                if (SimulateWinBoard(room, copy, row, c, disc)) return 100000 + depth;
                int score = Minimax(room, copy, depth - 1, false, alpha, beta, maxDisc, minDisc);
                best = Math.Max(best, score);
                alpha = Math.Max(alpha, best);
                if (beta <= alpha) break;
            }
            return best;
        }
        else
        {
            int best = int.MaxValue;
            foreach (int c in validCols)
            {
                int row = GetDropRow(board, room.Rows, c);
                if (row < 0) continue;
                var copy = CloneBoard2(board, room.Rows, room.Cols);
                copy[row][c] = disc;
                if (SimulateWinBoard(room, copy, row, c, disc)) return -100000 - depth;
                int score = Minimax(room, copy, depth - 1, true, alpha, beta, maxDisc, minDisc);
                best = Math.Min(best, score);
                beta = Math.Min(beta, best);
                if (beta <= alpha) break;
            }
            return best;
        }
    }

    private static int ScoreBoard(ConnectSumRoom room, int[][] board, int maxDisc, int minDisc)
    {
        int score = 0;
        int center = room.Cols / 2;
        // Center column preference
        for (int r = 0; r < room.Rows; r++)
        {
            if (board[r][center] == maxDisc) score += 3;
            else if (board[r][center] == minDisc) score -= 3;
        }
        return score;
    }

    private static int GetDropRow(int[][] board, int rows, int col)
    {
        for (int r = rows - 1; r >= 0; r--)
            if (board[r][col] == 0) return r;
        return -1;
    }

    private static int SimulateDrop(ConnectSumRoom room, int col)
    {
        for (int r = room.Rows - 1; r >= 0; r--)
            if (room.Board[r][col] == 0) return r;
        return -1;
    }

    private static int[][] CloneBoard(ConnectSumRoom room)
    {
        var copy = new int[room.Rows][];
        for (int r = 0; r < room.Rows; r++) { copy[r] = new int[room.Cols]; Array.Copy(room.Board[r], copy[r], room.Cols); }
        return copy;
    }

    private static int[][] CloneBoard2(int[][] board, int rows, int cols)
    {
        var copy = new int[rows][];
        for (int r = 0; r < rows; r++) { copy[r] = new int[cols]; Array.Copy(board[r], copy[r], cols); }
        return copy;
    }

    private static bool SimulateWin(ConnectSumRoom room, int[][] board, int row, int col, int player)
    {
        return SimulateWinBoard(room, board, row, col, player);
    }

    private static bool SimulateWinBoard(ConnectSumRoom room, int[][] board, int row, int col, int player)
    {
        int n = room.ConnectN;
        int rows = room.Rows, cols = room.Cols;
        int[][] dirs = [[0,1],[1,0],[1,1],[1,-1]];
        foreach (var d in dirs)
        {
            int count = 1;
            for (int s = 1; s < n; s++)
            {
                int r2 = row + d[0]*s, c2 = col + d[1]*s;
                if (r2 < 0 || r2 >= rows || c2 < 0 || c2 >= cols || board[r2][c2] != player) break;
                count++;
            }
            for (int s = 1; s < n; s++)
            {
                int r2 = row - d[0]*s, c2 = col - d[1]*s;
                if (r2 < 0 || r2 >= rows || c2 < 0 || c2 >= cols || board[r2][c2] != player) break;
                count++;
            }
            if (count >= n) return true;
        }
        return false;
    }

    // Hint: returns best column for current player
    public static int ComputeHint(ConnectSumRoom room, int playerIndex)
    {
        var valid = GetValidCols(room);
        if (valid.Count == 0) return -1;
        int disc = playerIndex + 1;
        int opp = disc == 1 ? 2 : 1;
        // Win immediately
        foreach (int c in valid)
        {
            int row = SimulateDrop(room, c);
            if (row >= 0)
            {
                var copy = CloneBoard(room);
                copy[row][c] = disc;
                if (SimulateWin(room, copy, row, c, disc)) return c;
            }
        }
        // Block opponent
        foreach (int c in valid)
        {
            int row = SimulateDrop(room, c);
            if (row >= 0)
            {
                var copy = CloneBoard(room);
                copy[row][c] = opp;
                if (SimulateWin(room, copy, row, c, opp)) return c;
            }
        }
        // Center
        int center = room.Cols / 2;
        if (valid.Contains(center)) return center;
        return valid[valid.Count / 2];
    }
}
