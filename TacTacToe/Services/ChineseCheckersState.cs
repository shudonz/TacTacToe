namespace TacTacToe.Services;

public class ChineseCheckersRoom
{
    public string Id { get; set; } = "";
    public string HostConnectionId { get; set; } = "";
    public string HostName { get; set; } = "";
    public List<ChineseCheckersPlayer> Players { get; set; } = [];
    public ChineseCheckersSettings Settings { get; set; } = new();
    public bool Started { get; set; }
    public bool IsOver { get; set; }
    public bool IsSinglePlayer { get; set; }
    public int CurrentPlayerIndex { get; set; }
    public string? WinnerName { get; set; }
    public List<ChineseCheckersPiece> Pieces { get; set; } = [];
    public long StartedAtMs { get; set; }
    public ChineseCheckersLastMove? LastMove { get; set; }
}

public class ChineseCheckersLastMove
{
    public string PieceId { get; set; } = "";
    public int OwnerIndex { get; set; }
    public List<string> Path { get; set; } = []; // all node IDs from start to end (inclusive)
    public bool IsJump { get; set; }
}

public class ChineseCheckersSettings
{
    public string RoomName { get; set; } = "Chinese Checkers Room";
    public int MaxPlayers { get; set; } = 6;
    public bool FillWithBotsOnStart { get; set; }
}

public class ChineseCheckersPlayer
{
    public string ConnectionId { get; set; } = "";
    public string Name { get; set; } = "";
    public bool Connected { get; set; } = true;
    public bool IsBot { get; set; }
    public int ColorIndex { get; set; }
    public int FinishRank { get; set; }
}

public class ChineseCheckersPiece
{
    public string Id { get; set; } = "";
    public int OwnerIndex { get; set; }
    public string NodeId { get; set; } = "";
}

public class ChineseCheckersNode
{
    public string Id { get; set; } = "";
    public int Arm { get; set; }
    public int Ring { get; set; }
    public double X { get; set; }
    public double Y { get; set; }
}

public class ChineseCheckersHint
{
    public bool HintAvailable { get; set; }
    public string Description { get; set; } = "";
    public string PieceId { get; set; } = "";
    public string ToNodeId { get; set; } = "";
}

public class ChineseCheckersMove
{
    public string PieceId { get; set; } = "";
    public string ToNodeId { get; set; } = "";
    public bool IsJump { get; set; }
}

public static class ChineseCheckersEngine
{
    // The board is a hexagram with 6 arms (N, NE, SE, S, SW, NW) of 10 nodes each
    // and a 61-node central hexagon — 121 nodes total.
    // Nodes use "row_dcol" IDs in a 17-row doubled-column triangular grid.
    private const int TotalArms = 6;
    private const int PiecesPerPlayer = 10;

    // Row layout: (startDcol, nodeCount) for each of 17 rows (0–16).
    // Nodes in each row have dcol = start, start+2, start+4, …
    // The parity of dcol always matches the parity of row.
    private static readonly (int Start, int Count)[] RowLayout =
    [
        (12, 1),  // row  0 – top tip (arm 0)
        (11, 2),  // row  1
        (10, 3),  // row  2
        (9,  4),  // row  3
        (0,  13), // row  4 – widest upper row
        (1,  12), // row  5
        (2,  11), // row  6
        (3,  10), // row  7
        (4,  9),  // row  8 – equator
        (3,  10), // row  9
        (2,  11), // row 10
        (1,  12), // row 11
        (0,  13), // row 12 – widest lower row
        (9,  4),  // row 13
        (10, 3),  // row 14
        (11, 2),  // row 15
        (12, 1),  // row 16 – bottom tip (arm 3)
    ];

    // Which arm each player occupies, keyed by player count.
    // Opposite arm = (startArm + 3) % 6 is always the goal.
    private static readonly int[][] PlayerArmMap =
    [
        [],                     // 0 players
        [0],                    // 1 player
        [0, 3],                 // 2 players
        [0, 2, 4],              // 3 players
        [0, 1, 3, 4],           // 4 players
        [0, 1, 2, 3, 4],        // 5 players
        [0, 1, 2, 3, 4, 5],     // 6 players
    ];

    private static readonly List<ChineseCheckersNode> _nodes = BuildNodes();
    private static readonly Dictionary<string, HashSet<string>> _adjacency = BuildAdjacency(_nodes);
    private static readonly HashSet<string>[] _armNodes = BuildArmNodeSets(_nodes);
    private static readonly HashSet<string> _boardNodeSet = new(_nodes.Select(n => n.Id));

    public static IReadOnlyList<ChineseCheckersNode> Nodes => _nodes;

    public static void StartGame(ChineseCheckersRoom room)
    {
        room.Settings.MaxPlayers = TotalArms;
        room.Started = true;
        room.IsOver = false;
        room.WinnerName = null;
        room.CurrentPlayerIndex = 0;
        room.StartedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        for (int i = 0; i < room.Players.Count; i++)
        {
            room.Players[i].ColorIndex = i;
            room.Players[i].FinishRank = 0;
        }

        room.Pieces = BuildStartingPieces(room.Players.Count);
    }

    public static Dictionary<string, string> BuildOccupancy(ChineseCheckersRoom room) =>
        room.Pieces.ToDictionary(p => p.NodeId, p => p.Id);

    public static List<ChineseCheckersMove> GetLegalMoves(ChineseCheckersRoom room, int playerIndex)
    {
        var occupancy = BuildOccupancy(room);
        var moves     = new List<ChineseCheckersMove>();
        int targetArm = TargetArm(playerIndex, room.Players.Count);

        foreach (var piece in room.Pieces.Where(p => p.OwnerIndex == playerIndex))
        {
            // Once a piece has entered its destination zone it cannot leave.
            bool inGoal     = _armNodes[targetArm].Contains(piece.NodeId);
            int  restrictTo = inGoal ? targetArm : -1;

            // Single steps to adjacent empty nodes
            foreach (var next in _adjacency[piece.NodeId])
            {
                if (occupancy.ContainsKey(next)) continue;
                if (inGoal && !_armNodes[targetArm].Contains(next)) continue; // must stay in goal
                moves.Add(new ChineseCheckersMove { PieceId = piece.Id, ToNodeId = next, IsJump = false });
            }

            // All destinations reachable via one or more chained jumps
            foreach (var dest in FindAllJumpDestinations(piece.NodeId, occupancy, restrictTo))
                moves.Add(new ChineseCheckersMove { PieceId = piece.Id, ToNodeId = dest, IsJump = true });
        }

        // If a destination is reachable both by step and jump, prefer the jump
        return moves
            .GroupBy(m => (m.PieceId, m.ToNodeId))
            .Select(g => g.OrderByDescending(x => x.IsJump).First())
            .ToList();
    }

    public static bool TryMove(ChineseCheckersRoom room, int playerIndex, string pieceId, string toNodeId)
    {
        var legal = GetLegalMoves(room, playerIndex);
        var legalMove = legal.FirstOrDefault(m => m.PieceId == pieceId && m.ToNodeId == toNodeId);
        if (legalMove == null) return false;

        var piece = room.Pieces.FirstOrDefault(p => p.Id == pieceId && p.OwnerIndex == playerIndex);
        if (piece == null) return false;

        // Compute the full hop path before moving the piece
        List<string> path;
        if (legalMove.IsJump)
        {
            var occupancy = BuildOccupancy(room);
            int targetArm = TargetArm(playerIndex, room.Players.Count);
            bool inGoal = _armNodes[targetArm].Contains(piece.NodeId);
            path = ComputeJumpPath(piece.NodeId, toNodeId, occupancy, inGoal ? targetArm : -1);
        }
        else
        {
            path = [piece.NodeId, toNodeId];
        }

        room.LastMove = new ChineseCheckersLastMove
        {
            PieceId  = pieceId,
            OwnerIndex = playerIndex,
            Path     = path,
            IsJump   = legalMove.IsJump
        };

        piece.NodeId = toNodeId;
        return true;
    }

    public static bool HasPlayerFinished(ChineseCheckersRoom room, int playerIndex)
    {
        int targetArm = TargetArm(playerIndex, room.Players.Count);
        var mine = room.Pieces.Where(p => p.OwnerIndex == playerIndex).Select(p => p.NodeId).ToHashSet();
        return _armNodes[targetArm].All(mine.Contains);
    }

    public static ChineseCheckersHint ComputeHint(ChineseCheckersRoom room, int playerIndex)
    {
        var moves = GetLegalMoves(room, playerIndex);
        if (moves.Count == 0)
            return new ChineseCheckersHint { HintAvailable = false, Description = "No legal moves available." };

        int targetArm = TargetArm(playerIndex, room.Players.Count);
        var best = moves
            .OrderByDescending(m => ScoreMove(room, playerIndex, m, targetArm))
            .ThenByDescending(m => PieceProgressScore(room, playerIndex, m.PieceId, targetArm))
            .ThenByDescending(m => m.IsJump)
            .First();

        var piece = room.Pieces.First(p => p.Id == best.PieceId);

        return new ChineseCheckersHint
        {
            HintAvailable = true,
            PieceId = best.PieceId,
            ToNodeId = best.ToNodeId,
            Description = best.IsJump
                ? $"Jump from {LabelForNode(piece.NodeId)} to {LabelForNode(best.ToNodeId)}."
                : $"Step from {LabelForNode(piece.NodeId)} to {LabelForNode(best.ToNodeId)}."
        };
    }

    public static ChineseCheckersMove? ChooseBotMove(ChineseCheckersRoom room, int playerIndex)
    {
        var moves = GetLegalMoves(room, playerIndex);
        if (moves.Count == 0) return null;

        int targetArm = TargetArm(playerIndex, room.Players.Count);

        return moves
            .OrderByDescending(m => ScoreMove(room, playerIndex, m, targetArm))
            // Among equal scores: advance the laggard piece (furthest from its goal)
            .ThenByDescending(m => PieceProgressScore(room, playerIndex, m.PieceId, targetArm))
            .ThenByDescending(m => m.IsJump)
            .First();
    }

    // Helper: current distance-to-goal for the piece being moved
    private static int PieceDistanceToGoal(ChineseCheckersRoom room, int playerIndex, string pieceId)
    {
        var piece = room.Pieces.FirstOrDefault(p => p.Id == pieceId);
        return piece == null ? 0 : DistanceToGoal(playerIndex, piece.NodeId, room.Players.Count);
    }

    // For secondary sort: pieces outside goal → distance to goal (laggards first);
    // pieces inside goal → how shallow they are (ring) so shallowest piece moves deeper first.
    private static int PieceProgressScore(ChineseCheckersRoom room, int playerIndex, string pieceId, int targetArm)
    {
        var piece = room.Pieces.FirstOrDefault(p => p.Id == pieceId);
        if (piece == null) return 0;
        if (_armNodes[targetArm].Contains(piece.NodeId))
        {
            // In goal: the shallowest piece (lowest ring) should move deeper.
            // Negate so that descending order (used by caller) picks the lowest ring first.
            var (r, d) = ParseNode(piece.NodeId);
            return -GetNodeRing(r, d);
        }
        return DistanceToGoal(playerIndex, piece.NodeId, room.Players.Count);
    }

    public static int ScoreForPlayer(ChineseCheckersRoom room, int playerIndex)
    {
        int score = 0;
        foreach (var piece in room.Pieces.Where(p => p.OwnerIndex == playerIndex))
            score += Math.Max(0, 8 - DistanceToGoal(playerIndex, piece.NodeId, room.Players.Count));
        if (HasPlayerFinished(room, playerIndex)) score += 100;
        return score;
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    // Score a move from the perspective of playerIndex.
    // Primary scoring axis:
    //   • Pieces NOT yet in goal: reward reducing distance to goal; bonus for entering goal.
    //   • Pieces already IN goal: reward moving to a deeper spot (higher ring = closer to tip).
    private static int ScoreMove(ChineseCheckersRoom room, int playerIndex, ChineseCheckersMove move, int targetArm)
    {
        var piece = room.Pieces.First(p => p.Id == move.PieceId);
        bool fromGoal = _armNodes[targetArm].Contains(piece.NodeId);
        bool toGoal   = _armNodes[targetArm].Contains(move.ToNodeId);

        int score;
        if (fromGoal && toGoal)
        {
            // In goal: reward moving to a deeper spot (higher ring number).
            var (fr, fd) = ParseNode(piece.NodeId);
            var (tr, td) = ParseNode(move.ToNodeId);
            score = GetNodeRing(tr, td) - GetNodeRing(fr, fd);
        }
        else
        {
            // Normal progression: reward shrinking distance to goal.
            score = DistanceToGoal(playerIndex, piece.NodeId, room.Players.Count)
                  - DistanceToGoal(playerIndex, move.ToNodeId, room.Players.Count);
            // Bonus for entering the goal zone.
            if (!fromGoal && toGoal) score += 4;
        }

        if (move.IsJump) score += 1;
        return score;
    }

    // BFS from 'from', tracking the parent of each visited node.
    // Reconstructs the shortest hop path from 'from' to 'to'.
    // Returns [from, hop1, …, to] or falls back to [from, to] if path not found.
    private static List<string> ComputeJumpPath(string from, string to, Dictionary<string, string> occupancy, int restrictToArm)
    {
        var parent = new Dictionary<string, string>();
        var visited = new HashSet<string> { from };
        var queue = new Queue<string>();
        queue.Enqueue(from);

        while (queue.Count > 0)
        {
            var current = queue.Dequeue();
            if (current == to) break;

            var (cr, cd) = ParseNode(current);
            foreach (var neighbor in _adjacency[current])
            {
                if (!occupancy.ContainsKey(neighbor)) continue;
                var (nr, nd) = ParseNode(neighbor);
                int dr = nr - cr, dd = nd - cd;
                string landing = NodeId(nr + dr, nd + dd);

                if (!_boardNodeSet.Contains(landing)) continue;
                if (occupancy.ContainsKey(landing)) continue;
                if (visited.Contains(landing)) continue;
                if (restrictToArm >= 0 && !_armNodes[restrictToArm].Contains(landing)) continue;

                visited.Add(landing);
                parent[landing] = current;
                queue.Enqueue(landing);
            }
        }

        if (!parent.ContainsKey(to) && to != from)
        {
            // This should only happen if the destination was not reachable via valid jumps,
            // which GetLegalMoves should have already prevented. Return a direct path as a safe fallback.
            return [from, to];
        }

        var path = new List<string>();
        var node = to;
        while (node != from)
        {
            path.Add(node);
            if (!parent.TryGetValue(node, out var p)) break;
            node = p;
        }
        path.Add(from);
        path.Reverse();
        return path;
    }

    // Cube-coordinate distance from 'nodeId' to the nearest node in the target arm.
    // Cube coords centred on (row=8, dcol=12):
    //   q = (dcol - row - 4) / 2,  rc = row - 8,  s = -q - rc
    private static int DistanceToGoal(int playerIndex, string nodeId, int playerCount)
    {
        int targetArm = TargetArm(playerIndex, playerCount);
        var (nr, nd) = ParseNode(nodeId);
        int nq = (nd - nr - 4) / 2;
        int nrc = nr - 8;
        int ns = -nq - nrc;

        int minDist = int.MaxValue;
        foreach (var gId in _armNodes[targetArm])
        {
            var (gr, gd) = ParseNode(gId);
            int gq = (gd - gr - 4) / 2;
            int grc = gr - 8;
            int gs = -gq - grc;
            int d = Math.Max(Math.Abs(nq - gq), Math.Max(Math.Abs(nrc - grc), Math.Abs(ns - gs)));
            if (d < minDist) minDist = d;
        }
        return minDist == int.MaxValue ? 0 : minDist;
    }

    private static string LabelForNode(string nodeId)
    {
        var (r, d) = ParseNode(nodeId);
        return $"row {r + 1}, col {d / 2 + 1}";
    }

    // The arm a given player starts in
    private static int PlayerArm(int playerIndex, int playerCount)
    {
        var map = PlayerArmMap[Math.Clamp(playerCount, 0, TotalArms)];
        return map[playerIndex % map.Length];
    }

    // The arm a given player is trying to fill (opposite start arm)
    private static int TargetArm(int playerIndex, int playerCount) =>
        (PlayerArm(playerIndex, playerCount) + 3) % TotalArms;

    private static HashSet<string>[] BuildArmNodeSets(List<ChineseCheckersNode> nodes)
    {
        var sets = new HashSet<string>[TotalArms];
        for (int i = 0; i < TotalArms; i++)
            sets[i] = new HashSet<string>(nodes.Where(n => n.Arm == i).Select(n => n.Id));
        return sets;
    }

    private static List<ChineseCheckersPiece> BuildStartingPieces(int playerCount)
    {
        var pieces = new List<ChineseCheckersPiece>();
        for (int p = 0; p < playerCount; p++)
        {
            int arm = PlayerArm(p, playerCount);
            int i = 0;
            foreach (var nodeId in _armNodes[arm])
                pieces.Add(new ChineseCheckersPiece { Id = $"P{p}_{i++}", OwnerIndex = p, NodeId = nodeId });
        }
        return pieces;
    }

    // Compact node ID: "{row}_{dcol}"
    private static string NodeId(int row, int dcol) => $"{row}_{dcol}";

    private static (int row, int dcol) ParseNode(string id)
    {
        int sep = id.IndexOf('_');
        return (int.Parse(id[..sep]), int.Parse(id[(sep + 1)..]));
    }

    // BFS over all nodes reachable from 'from' by one or more consecutive jumps.
    // When restrictToArm >= 0 the piece must stay within that arm on every landing
    // (enforces the "can't leave destination zone" rule).
    private static HashSet<string> FindAllJumpDestinations(string from, Dictionary<string, string> occupancy, int restrictToArm = -1)
    {
        var visited = new HashSet<string> { from };
        var queue = new Queue<string>();
        queue.Enqueue(from);

        while (queue.Count > 0)
        {
            var current = queue.Dequeue();
            var (cr, cd) = ParseNode(current);

            foreach (var neighbor in _adjacency[current])
            {
                if (!occupancy.ContainsKey(neighbor)) continue; // must jump over an occupied node

                var (nr, nd) = ParseNode(neighbor);
                int dr = nr - cr, dd = nd - cd;
                string landing = NodeId(nr + dr, nd + dd);

                if (!_boardNodeSet.Contains(landing)) continue;
                if (occupancy.ContainsKey(landing)) continue;  // landing must be empty
                if (visited.Contains(landing)) continue;        // avoid revisiting
                // Honour destination-zone restriction: landing must stay in the arm
                if (restrictToArm >= 0 && !_armNodes[restrictToArm].Contains(landing)) continue;

                visited.Add(landing);
                queue.Enqueue(landing);
            }
        }

        visited.Remove(from); // the starting node is not a valid destination
        return visited;
    }

    // Build the 121 board nodes from the row layout.
    // Positions: x = dcol/24*96+2 (%), y = row/16*96+2 (%) — both in range [2, 98].
    private static List<ChineseCheckersNode> BuildNodes()
    {
        var nodes = new List<ChineseCheckersNode>();
        for (int r = 0; r < RowLayout.Length; r++)
        {
            var (start, count) = RowLayout[r];
            for (int i = 0; i < count; i++)
            {
                int dcol = start + i * 2;
                double x = (double)dcol / 24.0 * 96.0 + 2.0;
                double y = (double)r   / 16.0 * 96.0 + 2.0;
                nodes.Add(new ChineseCheckersNode
                {
                    Id   = NodeId(r, dcol),
                    Arm  = GetNodeArm(r, dcol),
                    Ring = GetNodeRing(r, dcol),
                    X    = x,
                    Y    = y,
                });
            }
        }
        return nodes;
    }

    // Arm index for a node: 0=N, 1=NE, 2=SE, 3=S, 4=SW, 5=NW, -1=central hex
    private static int GetNodeArm(int r, int dcol)
    {
        if (r <= 3)  return 0;  // top arm (N)
        if (r >= 13) return 3;  // bottom arm (S)

        // Central-hexagon left boundary = |r−8| + 4
        int cl = Math.Abs(r - 8) + 4;
        int cr = 24 - cl;

        if (r <= 8) // upper half
        {
            if (dcol < cl) return 5;  // NW arm
            if (dcol > cr) return 1;  // NE arm
        }
        else        // lower half
        {
            if (dcol < cl) return 4;  // SW arm
            if (dcol > cr) return 2;  // SE arm
        }
        return -1;  // central hexagon
    }

    // Cube-coordinate distance from the board centre — used as the "Ring" metadata.
    private static int GetNodeRing(int r, int dcol)
    {
        int q  = (dcol - r - 4) / 2;
        int rc = r - 8;
        int s  = -q - rc;
        return Math.Max(Math.Abs(q), Math.Max(Math.Abs(rc), Math.Abs(s)));
    }

    // Build the 6-neighbour adjacency list for the triangular grid.
    // Two nodes are adjacent when they are reachable by one of the six
    // unit vectors: (row±1, dcol±1) for diagonal steps or (row, dcol±2) for lateral steps.
    private static Dictionary<string, HashSet<string>> BuildAdjacency(List<ChineseCheckersNode> nodes)
    {
        var nodeSet = new HashSet<string>(nodes.Select(n => n.Id));
        var graph   = nodes.ToDictionary(n => n.Id, _ => new HashSet<string>());

        int[][] deltas = [[0, -2], [0, 2], [-1, -1], [-1, 1], [1, -1], [1, 1]];

        foreach (var node in nodes)
        {
            var (r, d) = ParseNode(node.Id);
            foreach (var delta in deltas)
            {
                string nb = NodeId(r + delta[0], d + delta[1]);
                if (nodeSet.Contains(nb))
                    graph[node.Id].Add(nb);
            }
        }

        return graph;
    }
}
