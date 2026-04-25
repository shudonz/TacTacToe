namespace TacTacToe.Services;

// ─── Data model ──────────────────────────────────────────────────────────────

public class BonesRoom
{
    public string Id { get; set; } = "";
    public string HostConnectionId { get; set; } = "";
    public string HostName { get; set; } = "";
    public List<BonesPlayer> Players { get; set; } = [];
    public BonesSettings Settings { get; set; } = new();
    public bool Started { get; set; }
    public bool IsOver { get; set; }
    public bool IsSinglePlayer { get; set; }

    // Round state
    public int RoundNumber { get; set; }
    public int CurrentPlayerIndex { get; set; }
    public List<int> Boneyard { get; set; } = [];       // tile IDs not yet drawn
    public List<BonesChainEntry> Chain { get; set; } = []; // played tiles in order
    public int LeftOpenEnd { get; set; } = -1;          // pip value at left end of chain
    public int RightOpenEnd { get; set; } = -1;         // pip value at right end of chain
    public bool RoundOver { get; set; }
    public string? RoundWinnerName { get; set; }
    public bool GameBlocked { get; set; }               // nobody can play
    public long StartedAtMs { get; set; }
    public bool SessionsSaved { get; set; }
    public string? WinnerName { get; set; }             // final game winner
}

public class BonesSettings
{
    public string RoomName { get; set; } = "Bones Room";
    public int MaxPlayers { get; set; } = 4;
    public int TargetScore { get; set; } = 100;         // first to this score wins the game
    public bool FillWithBotsOnStart { get; set; }
}

public class BonesPlayer
{
    public string ConnectionId { get; set; } = "";
    public string Name { get; set; } = "";
    public bool Connected { get; set; } = true;
    public bool IsBot { get; set; }
    public List<int> Hand { get; set; } = [];
    public int TotalScore { get; set; }                 // accumulated over rounds
    public bool Passed { get; set; }                    // passed this turn (can't play or draw)
    public int? FinishRank { get; set; }                // 1 = game winner
}

public class BonesChainEntry
{
    public int TileId { get; set; }
    public int ShownLeft { get; set; }                  // pip displayed on the left side
    public int ShownRight { get; set; }                 // pip displayed on the right side
}

public class BonesHint
{
    public bool HintAvailable { get; set; }
    public int TileId { get; set; } = -1;
    public string PlaceAt { get; set; } = "";          // "left" | "right" | "any"
    public string Description { get; set; } = "";
}

// ─── Engine ──────────────────────────────────────────────────────────────────

public static class BonesEngine
{
    // All 28 tiles of a double-6 set, ordered by (low, high)
    // tileId 0 = (0,0), 1 = (0,1), ..., 27 = (6,6)
    public static (int Low, int High) GetPips(int tileId)
    {
        int idx = 0;
        for (int a = 0; a <= 6; a++)
            for (int b = a; b <= 6; b++)
            {
                if (idx == tileId) return (a, b);
                idx++;
            }
        throw new ArgumentOutOfRangeException(nameof(tileId));
    }

    public static int TileId(int low, int high)
    {
        if (low > high) (low, high) = (high, low);
        int idx = 0;
        for (int a = 0; a <= 6; a++)
            for (int b = a; b <= 6; b++)
            {
                if (a == low && b == high) return idx;
                idx++;
            }
        throw new ArgumentOutOfRangeException($"No tile ({low},{high})");
    }

    public static bool IsDouble(int tileId)
    {
        var (l, h) = GetPips(tileId);
        return l == h;
    }

    public static int PipCount(int tileId)
    {
        var (l, h) = GetPips(tileId);
        return l + h;
    }

    public static int HandPipCount(IEnumerable<int> hand) =>
        hand.Sum(t => PipCount(t));

    // Returns all 28 tile IDs shuffled
    public static List<int> ShuffledSet() =>
        Enumerable.Range(0, 28).OrderBy(_ => Random.Shared.Next()).ToList();

    public static void StartRound(BonesRoom room)
    {
        room.RoundOver = false;
        room.RoundWinnerName = null;
        room.GameBlocked = false;
        room.Chain.Clear();
        room.LeftOpenEnd = -1;
        room.RightOpenEnd = -1;

        foreach (var p in room.Players)
        {
            p.Hand.Clear();
            p.Passed = false;
        }

        var tiles = ShuffledSet();

        // Deal tiles: 7 each for 2-4 players (standard)
        int tilesPerPlayer = 7;
        foreach (var p in room.Players)
        {
            for (int i = 0; i < tilesPerPlayer && tiles.Count > 0; i++)
            {
                p.Hand.Add(tiles[^1]);
                tiles.RemoveAt(tiles.Count - 1);
            }
        }

        room.Boneyard = tiles;

        // Determine starting player: whoever has the highest double;
        // if no doubles, the player with the highest single tile starts.
        room.CurrentPlayerIndex = FindStartingPlayer(room);
    }

    public static void StartGame(BonesRoom room)
    {
        room.Started = true;
        room.IsOver = false;
        room.WinnerName = null;
        room.RoundNumber = 0;
        room.SessionsSaved = false;
        room.StartedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        foreach (var p in room.Players)
        {
            p.TotalScore = 0;
            p.FinishRank = null;
        }

        room.RoundNumber = 1;
        StartRound(room);
    }

    private static int FindStartingPlayer(BonesRoom room)
    {
        // Find highest double in any hand
        int bestDouble = -1;
        int bestPlayer = -1;
        for (int pi = 0; pi < room.Players.Count; pi++)
        {
            foreach (var tid in room.Players[pi].Hand)
            {
                var (l, h) = GetPips(tid);
                if (l == h && l > bestDouble)
                {
                    bestDouble = l;
                    bestPlayer = pi;
                }
            }
        }

        if (bestPlayer >= 0) return bestPlayer;

        // No doubles — highest single pip total
        int bestPip = -1;
        for (int pi = 0; pi < room.Players.Count; pi++)
        {
            int max = room.Players[pi].Hand.Max(t => PipCount(t));
            if (max > bestPip) { bestPip = max; bestPlayer = pi; }
        }

        return Math.Max(0, bestPlayer);
    }

    // Returns which ends a tile can be placed on: "left", "right", "both", "none"
    public static string CanPlace(BonesRoom room, int tileId)
    {
        var (l, h) = GetPips(tileId);

        if (room.Chain.Count == 0) return "any"; // first tile goes anywhere

        bool onLeft  = l == room.LeftOpenEnd  || h == room.LeftOpenEnd;
        bool onRight = l == room.RightOpenEnd || h == room.RightOpenEnd;

        if (onLeft && onRight) return "both";
        if (onLeft)  return "left";
        if (onRight) return "right";
        return "none";
    }

    public static bool PlaceTile(BonesRoom room, int playerIndex, int tileId, string side, out string error)
    {
        error = "";
        if (playerIndex < 0 || playerIndex >= room.Players.Count) { error = "Invalid player."; return false; }
        var player = room.Players[playerIndex];
        if (!player.Hand.Contains(tileId)) { error = "Tile not in hand."; return false; }

        var placement = CanPlace(room, tileId);
        if (placement == "none") { error = "Tile cannot be placed."; return false; }

        var (l, h) = GetPips(tileId);

        if (room.Chain.Count == 0)
        {
            // First tile
            room.Chain.Add(new BonesChainEntry { TileId = tileId, ShownLeft = l, ShownRight = h });
            room.LeftOpenEnd = l;
            room.RightOpenEnd = h;
        }
        else
        {
            // Determine actual side to use
            string actualSide = side;
            if (placement == "left")  actualSide = "left";
            if (placement == "right") actualSide = "right";
            if (placement == "both" && actualSide != "left" && actualSide != "right")
                actualSide = "right"; // default

            if (actualSide == "left")
            {
                if (l == room.LeftOpenEnd)
                {
                    room.Chain.Insert(0, new BonesChainEntry { TileId = tileId, ShownLeft = h, ShownRight = l });
                    room.LeftOpenEnd = h;
                }
                else // h == room.LeftOpenEnd
                {
                    room.Chain.Insert(0, new BonesChainEntry { TileId = tileId, ShownLeft = l, ShownRight = h });
                    room.LeftOpenEnd = l;
                }
            }
            else // right
            {
                if (l == room.RightOpenEnd)
                {
                    room.Chain.Add(new BonesChainEntry { TileId = tileId, ShownLeft = l, ShownRight = h });
                    room.RightOpenEnd = h;
                }
                else // h == room.RightOpenEnd
                {
                    room.Chain.Add(new BonesChainEntry { TileId = tileId, ShownLeft = h, ShownRight = l });
                    room.RightOpenEnd = l;
                }
            }
        }

        player.Hand.Remove(tileId);
        player.Passed = false;
        return true;
    }

    public static bool DrawFromBoneyard(BonesRoom room, int playerIndex, out int drawnTile)
    {
        drawnTile = -1;
        if (room.Boneyard.Count == 0) return false;
        drawnTile = room.Boneyard[^1];
        room.Boneyard.RemoveAt(room.Boneyard.Count - 1);
        room.Players[playerIndex].Hand.Add(drawnTile);
        room.Players[playerIndex].Passed = false;
        return true;
    }

    public static bool HasPlayableTile(BonesRoom room, int playerIndex)
    {
        if (playerIndex < 0 || playerIndex >= room.Players.Count) return false;
        return room.Players[playerIndex].Hand.Any(t => CanPlace(room, t) != "none");
    }

    // Check if the game is blocked (all players passed)
    public static bool CheckBlocked(BonesRoom room)
    {
        return room.Players.All(p => p.Passed || p.IsBot && !HasPlayableTile(room, room.Players.IndexOf(p)));
    }

    // Compute round winner and award points. Returns true if game is over.
    public static bool FinishRound(BonesRoom room, int winnerIndex)
    {
        var winner = room.Players[winnerIndex];
        room.RoundOver = true;
        room.RoundWinnerName = winner.Name;

        // Winner scores the sum of all pips remaining in others' hands
        int points = room.Players
            .Where((p, i) => i != winnerIndex)
            .Sum(p => HandPipCount(p.Hand));

        winner.TotalScore += points;

        // Check if someone crossed the target
        var gameWinner = room.Players.FirstOrDefault(p => p.TotalScore >= room.Settings.TargetScore);
        if (gameWinner != null)
        {
            room.IsOver = true;
            room.WinnerName = gameWinner.Name;
            gameWinner.FinishRank = 1;
            return true;
        }
        return false;
    }

    // For blocked game: player with fewest pips wins
    public static bool FinishBlockedRound(BonesRoom room)
    {
        room.GameBlocked = true;
        int minPips = room.Players.Min(p => HandPipCount(p.Hand));
        int winnerIndex = room.Players.FindIndex(p => HandPipCount(p.Hand) == minPips);
        return FinishRound(room, winnerIndex);
    }

    public static BonesHint ComputeHint(BonesRoom room, int playerIndex)
    {
        if (playerIndex < 0 || playerIndex >= room.Players.Count)
            return new BonesHint { HintAvailable = false, Description = "No hint available." };

        var player = room.Players[playerIndex];

        // Prefer to play a double
        var doubles = player.Hand.Where(t => IsDouble(t) && CanPlace(room, t) != "none").ToList();
        if (doubles.Any())
        {
            var tid = doubles.OrderByDescending(PipCount).First();
            var side = CanPlace(room, tid);
            if (side == "both") side = "right";
            var (l, _) = GetPips(tid);
            return new BonesHint
            {
                HintAvailable = true,
                TileId = tid,
                PlaceAt = side,
                Description = $"Play [{l}|{l}] on the {side} end."
            };
        }

        // Play any valid tile — prefer highest pip value
        var playable = player.Hand
            .Where(t => CanPlace(room, t) != "none")
            .OrderByDescending(PipCount)
            .ToList();

        if (playable.Any())
        {
            var tid = playable[0];
            var side = CanPlace(room, tid);
            if (side == "both") side = "right";
            var (l, h) = GetPips(tid);
            return new BonesHint
            {
                HintAvailable = true,
                TileId = tid,
                PlaceAt = side,
                Description = $"Play [{l}|{h}] on the {side} end."
            };
        }

        if (room.Boneyard.Count > 0)
        {
            return new BonesHint
            {
                HintAvailable = true,
                TileId = -1,
                PlaceAt = "draw",
                Description = "Draw from the boneyard."
            };
        }

        return new BonesHint
        {
            HintAvailable = false,
            TileId = -1,
            PlaceAt = "pass",
            Description = "No moves available — pass your turn."
        };
    }

    // Bot decision: returns (tileId, side) or (-1, "draw") or (-1, "pass")
    public static (int TileId, string Side) BotDecision(BonesRoom room, int botIndex)
    {
        var bot = room.Players[botIndex];

        // Strongly prefer to play doubles (can't be re-used later)
        var doubles = bot.Hand
            .Where(t => IsDouble(t) && CanPlace(room, t) != "none")
            .OrderByDescending(PipCount)
            .ToList();

        if (doubles.Any())
        {
            var tid = doubles[0];
            var side = CanPlace(room, tid);
            return (tid, side == "both" || side == "right" ? "right" : "left");
        }

        // Play the tile that leaves the most flexibility (highest sum), prefer matching the side with fewer tiles
        var playable = bot.Hand
            .Where(t => CanPlace(room, t) != "none")
            .OrderByDescending(PipCount)
            .ToList();

        if (playable.Any())
        {
            var tid = playable[0];
            var side = CanPlace(room, tid);
            return (tid, side == "both" || side == "right" ? "right" : "left");
        }

        if (room.Boneyard.Count > 0)
            return (-1, "draw");

        return (-1, "pass");
    }
}
