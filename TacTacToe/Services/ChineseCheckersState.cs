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
}

public class ChineseCheckersSettings
{
    public string RoomName { get; set; } = "Chinese Checkers Room";
    public int MaxPlayers { get; set; } = 7;
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
    private const int Arms = 7;
    private const int OuterRing = 6;
    private const int PiecesPerPlayer = 3;

    private static readonly List<ChineseCheckersNode> _nodes = BuildNodes();
    private static readonly Dictionary<string, HashSet<string>> _adjacency = BuildAdjacency(_nodes);

    public static IReadOnlyList<ChineseCheckersNode> Nodes => _nodes;

    public static void StartGame(ChineseCheckersRoom room)
    {
        room.Settings.MaxPlayers = 7;
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
        var moves = new List<ChineseCheckersMove>();

        foreach (var piece in room.Pieces.Where(p => p.OwnerIndex == playerIndex))
        {
            foreach (var next in _adjacency[piece.NodeId])
            {
                if (!occupancy.ContainsKey(next))
                {
                    moves.Add(new ChineseCheckersMove { PieceId = piece.Id, ToNodeId = next, IsJump = false });
                    continue;
                }

                var landing = FindLandingNode(piece.NodeId, next);
                if (landing != null && !occupancy.ContainsKey(landing))
                    moves.Add(new ChineseCheckersMove { PieceId = piece.Id, ToNodeId = landing, IsJump = true });
            }
        }

        return moves
            .GroupBy(m => (m.PieceId, m.ToNodeId))
            .Select(g => g.OrderByDescending(x => x.IsJump).First())
            .ToList();
    }

    public static bool TryMove(ChineseCheckersRoom room, int playerIndex, string pieceId, string toNodeId)
    {
        var legal = GetLegalMoves(room, playerIndex);
        if (!legal.Any(m => m.PieceId == pieceId && m.ToNodeId == toNodeId))
            return false;

        var piece = room.Pieces.FirstOrDefault(p => p.Id == pieceId && p.OwnerIndex == playerIndex);
        if (piece == null) return false;
        piece.NodeId = toNodeId;
        return true;
    }

    public static bool HasPlayerFinished(ChineseCheckersRoom room, int playerIndex)
    {
        int targetArm = TargetArm(playerIndex);
        var targets = GoalNodesForArm(targetArm);
        var mine = room.Pieces.Where(p => p.OwnerIndex == playerIndex).Select(p => p.NodeId).ToHashSet();
        return targets.All(mine.Contains);
    }

    public static ChineseCheckersHint ComputeHint(ChineseCheckersRoom room, int playerIndex)
    {
        var moves = GetLegalMoves(room, playerIndex);
        if (moves.Count == 0)
            return new ChineseCheckersHint { HintAvailable = false, Description = "No legal moves available." };

        var best = moves
            .OrderByDescending(m => ScoreMove(room, playerIndex, m))
            .ThenByDescending(m => m.IsJump)
            .First();

        var piece = room.Pieces.First(p => p.Id == best.PieceId);
        var fromLabel = LabelForNode(piece.NodeId);
        var toLabel = LabelForNode(best.ToNodeId);

        return new ChineseCheckersHint
        {
            HintAvailable = true,
            PieceId = best.PieceId,
            ToNodeId = best.ToNodeId,
            Description = best.IsJump
                ? $"Jump from {fromLabel} to {toLabel}."
                : $"Step from {fromLabel} to {toLabel}."
        };
    }

    public static ChineseCheckersMove? ChooseBotMove(ChineseCheckersRoom room, int playerIndex)
    {
        var moves = GetLegalMoves(room, playerIndex);
        if (moves.Count == 0) return null;

        return moves
            .OrderByDescending(m => ScoreMove(room, playerIndex, m))
            .ThenByDescending(m => m.IsJump)
            .First();
    }

    public static int ScoreForPlayer(ChineseCheckersRoom room, int playerIndex)
    {
        int targetArm = TargetArm(playerIndex);
        int progress = 0;
        foreach (var piece in room.Pieces.Where(p => p.OwnerIndex == playerIndex))
        {
            var node = _nodes.First(n => n.Id == piece.NodeId);
            int ringBonus = Math.Clamp(node.Ring, 0, OuterRing) * 10;
            int armBonus = node.Arm == targetArm ? 25 : 0;
            progress += ringBonus + armBonus;
        }

        if (HasPlayerFinished(room, playerIndex)) progress += 300;
        return progress;
    }

    private static int ScoreMove(ChineseCheckersRoom room, int playerIndex, ChineseCheckersMove move)
    {
        var piece = room.Pieces.First(p => p.Id == move.PieceId);
        int before = DistanceToGoal(playerIndex, piece.NodeId);
        int after = DistanceToGoal(playerIndex, move.ToNodeId);
        int gain = before - after;
        if (move.IsJump) gain += 2;
        return gain;
    }

    private static int DistanceToGoal(int playerIndex, string nodeId)
    {
        var node = _nodes.First(n => n.Id == nodeId);
        int target = TargetArm(playerIndex);

        int armDelta = Math.Abs(node.Arm - target);
        armDelta = Math.Min(armDelta, Arms - armDelta);

        int radial = OuterRing - node.Ring;
        int outward = Math.Abs(OuterRing - node.Ring);

        return armDelta * 3 + radial + outward;
    }

    private static string LabelForNode(string nodeId)
    {
        var n = _nodes.First(x => x.Id == nodeId);
        return $"arm {n.Arm + 1}, ring {n.Ring}";
    }

    private static int TargetArm(int playerIndex) => (playerIndex + 3) % Arms;

    private static HashSet<string> GoalNodesForArm(int arm) =>
        [$"{arm}-6", $"{arm}-5", $"{arm}-4"];

    private static List<ChineseCheckersPiece> BuildStartingPieces(int playerCount)
    {
        var pieces = new List<ChineseCheckersPiece>();
        for (int p = 0; p < playerCount; p++)
        {
            pieces.Add(new ChineseCheckersPiece { Id = $"P{p}_0", OwnerIndex = p, NodeId = $"{p}-6" });
            pieces.Add(new ChineseCheckersPiece { Id = $"P{p}_1", OwnerIndex = p, NodeId = $"{p}-5" });
            pieces.Add(new ChineseCheckersPiece { Id = $"P{p}_2", OwnerIndex = p, NodeId = $"{p}-4" });
        }
        return pieces;
    }

    private static List<ChineseCheckersNode> BuildNodes()
    {
        var nodes = new List<ChineseCheckersNode>
        {
            new() { Id = "C", Arm = 0, Ring = 0, X = 50, Y = 50 }
        };

        for (int ring = 1; ring <= OuterRing; ring++)
        {
            for (int arm = 0; arm < Arms; arm++)
            {
                double angle = (Math.PI * 2 * arm / Arms) - (Math.PI / 2);
                double radius = 7 + ring * 7.2;
                nodes.Add(new ChineseCheckersNode
                {
                    Id = $"{arm}-{ring}",
                    Arm = arm,
                    Ring = ring,
                    X = 50 + Math.Cos(angle) * radius,
                    Y = 50 + Math.Sin(angle) * radius
                });
            }
        }

        return nodes;
    }

    private static Dictionary<string, HashSet<string>> BuildAdjacency(List<ChineseCheckersNode> nodes)
    {
        var graph = nodes.ToDictionary(n => n.Id, _ => new HashSet<string>());

        for (int arm = 0; arm < Arms; arm++)
        {
            graph["C"].Add($"{arm}-1");
            graph[$"{arm}-1"].Add("C");

            for (int ring = 1; ring < OuterRing; ring++)
            {
                string a = $"{arm}-{ring}";
                string b = $"{arm}-{ring + 1}";
                graph[a].Add(b);
                graph[b].Add(a);
            }
        }

        for (int ring = 1; ring <= OuterRing; ring++)
        {
            for (int arm = 0; arm < Arms; arm++)
            {
                string a = $"{arm}-{ring}";
                string left = $"{(arm + Arms - 1) % Arms}-{ring}";
                string right = $"{(arm + 1) % Arms}-{ring}";
                graph[a].Add(left);
                graph[a].Add(right);
            }
        }

        return graph;
    }

    private static string? FindLandingNode(string from, string over)
    {
        if (from == "C")
        {
            var (oa, or) = ParseNode(over);
            return or == 1 ? $"{oa}-2" : null;
        }

        var (fa, fr) = ParseNode(from);
        if (over == "C") return null;

        var (oa2, or2) = ParseNode(over);

        if (fa == oa2)
        {
            int delta = or2 - fr;
            int ring = or2 + delta;
            if (ring < 1 || ring > OuterRing) return null;
            return $"{fa}-{ring}";
        }

        if (fr == or2)
        {
            int deltaArm = WrapDelta(fa, oa2);
            int landingArm = (oa2 + deltaArm + Arms) % Arms;
            return $"{landingArm}-{fr}";
        }

        return null;
    }

    private static (int arm, int ring) ParseNode(string id)
    {
        var parts = id.Split('-');
        return (int.Parse(parts[0]), int.Parse(parts[1]));
    }

    private static int WrapDelta(int a, int b)
    {
        int d = b - a;
        if (d > Arms / 2) d -= Arms;
        if (d < -Arms / 2) d += Arms;
        return Math.Clamp(d, -1, 1);
    }
}
