namespace TacTacToe.Services;

// ─── Enums ───────────────────────────────────────────────────────────────────

public enum RattlerDir { Up = 0, Down = 1, Left = 2, Right = 3 }

// ─── Room / Player models ────────────────────────────────────────────────────

public class RattlerRoom
{
    public string Id { get; set; } = "";
    public string HostConnectionId { get; set; } = "";
    public string HostName { get; set; } = "";
    public List<RattlerPlayer> Players { get; set; } = [];
    public RattlerSettings Settings { get; set; } = new();
    public bool Started { get; set; }
    public bool IsOver { get; set; }
    public bool IsSinglePlayer { get; set; }

    // Board
    public int GridW { get; set; } = 24;
    public int GridH { get; set; } = 24;
    public List<RattlerFood> Foods { get; set; } = [];

    // Game state
    public int TickNumber { get; set; }
    public string? WinnerName { get; set; }
    public long StartedAtMs { get; set; }
    public bool SessionsSaved { get; set; }
}

public class RattlerSettings
{
    public string RoomName { get; set; } = "Rattler Room";
    public int MaxPlayers { get; set; } = 2;
}

public class RattlerPlayer
{
    public string ConnectionId { get; set; } = "";
    public string Name { get; set; } = "";
    public bool IsBot { get; set; }
    public bool Connected { get; set; } = true;
    public bool Dead { get; set; }
    public List<RattlerPos> Body { get; set; } = [];   // Body[0] = head
    public RattlerDir Dir { get; set; } = RattlerDir.Right;
    public RattlerDir NextDir { get; set; } = RattlerDir.Right;
    public int Score { get; set; }
    public int? FinishRank { get; set; }
    public long? DiedAtMs { get; set; }
    public long? FinishedAtMs { get; set; }
}

public class RattlerPos
{
    public int X { get; set; }
    public int Y { get; set; }
}

public class RattlerFood
{
    public int X { get; set; }
    public int Y { get; set; }
    public int Value { get; set; }  // 1 = regular, 3 = silver, 10 = gold
}

// ─── Client state (serialised per player) ────────────────────────────────────

public class RattlerClientState
{
    public RattlerClientPlayer[] Players { get; set; } = [];
    public RattlerFood[] Foods { get; set; } = [];
    public bool IsOver { get; set; }
    public string? WinnerName { get; set; }
    public int TickNumber { get; set; }
    public bool Started { get; set; }
    public int GridW { get; set; }
    public int GridH { get; set; }
    public int MyIndex { get; set; }       // index of the calling player (-1 = spectator)
    public bool IsSinglePlayer { get; set; }
    public bool IsHost { get; set; }
}

public class RattlerClientPlayer
{
    public string Name { get; set; } = "";
    public bool IsBot { get; set; }
    public bool Dead { get; set; }
    public int Score { get; set; }
    public int Length { get; set; }
    public int[] BodyX { get; set; } = [];
    public int[] BodyY { get; set; } = [];
    public int? FinishRank { get; set; }
}

// ─── Room summaries (for lobby) ──────────────────────────────────────────────

public class RattlerRoomSummary
{
    public string Id { get; set; } = "";
    public string RoomName { get; set; } = "";
    public string HostName { get; set; } = "";
    public int PlayerCount { get; set; }
    public int MaxPlayers { get; set; }
    public bool Started { get; set; }
    public bool IsFull { get; set; }
}

// ─── Engine ──────────────────────────────────────────────────────────────────

public static class RattlerEngine
{
    private static readonly string[] BotNames = ["🐍 Slither", "🐍 Viper", "🐍 Cobra"];

    public static void StartGame(RattlerRoom room)
    {
        int w = room.GridW, h = room.GridH;

        // Position players diagonally opposite corners with initial length 4
        for (int i = 0; i < room.Players.Count; i++)
        {
            var p = room.Players[i];
            p.Dead = false;
            p.Score = 0;
            p.FinishRank = null;
            p.DiedAtMs = null;
            p.FinishedAtMs = null;
            p.Body.Clear();

            if (i == 0)
            {
                // Left-centre, heading right
                p.Dir = RattlerDir.Right;
                p.NextDir = RattlerDir.Right;
                int y = h / 3;
                for (int j = 0; j < 4; j++)
                    p.Body.Add(new RattlerPos { X = 3 + (3 - j), Y = y });
            }
            else
            {
                // Right-centre (offset row), heading left
                p.Dir = RattlerDir.Left;
                p.NextDir = RattlerDir.Left;
                int y = h * 2 / 3;
                for (int j = 0; j < 4; j++)
                    p.Body.Add(new RattlerPos { X = w - 4 - (3 - j), Y = y });
            }
        }

        room.Foods.Clear();
        room.TickNumber = 0;
        room.Started = true;
        room.IsOver = false;
        room.WinnerName = null;
        room.SessionsSaved = false;
        room.StartedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        // Spawn initial food
        for (int i = 0; i < 3; i++)
            SpawnFood(room);
    }

    public static bool Tick(RattlerRoom room)
    {
        if (room.IsOver) return false;

        var alive = room.Players.Where(p => !p.Dead).ToList();
        if (alive.Count == 0) { EndGame(room); return true; }

        room.TickNumber++;

        // Bot AI: compute next directions
        foreach (var p in alive.Where(p => p.IsBot))
            UpdateBotDirection(room, p);

        // Compute next head positions
        var nextHeads = new Dictionary<RattlerPlayer, RattlerPos>();
        foreach (var p in alive)
        {
            p.Dir = p.NextDir;
            var (dx, dy) = DirDelta(p.Dir);
            nextHeads[p] = new RattlerPos { X = p.Body[0].X + dx, Y = p.Body[0].Y + dy };
        }

        // Detect collisions
        var toKill = new HashSet<RattlerPlayer>();

        foreach (var p in alive)
        {
            var next = nextHeads[p];

            // Wall
            if (next.X < 0 || next.X >= room.GridW || next.Y < 0 || next.Y >= room.GridH)
            { toKill.Add(p); continue; }

            // Self-body (skip tail which moves away)
            for (int i = 0; i < p.Body.Count - 1; i++)
                if (p.Body[i].X == next.X && p.Body[i].Y == next.Y)
                { toKill.Add(p); break; }
        }

        // Cross-player collisions (only if not already dead)
        foreach (var p in alive)
        {
            if (toKill.Contains(p)) continue;
            var next = nextHeads[p];

            foreach (var other in alive)
            {
                if (other == p) continue;

                // Head-to-head
                if (nextHeads[other].X == next.X && nextHeads[other].Y == next.Y)
                { toKill.Add(p); toKill.Add(other); break; }

                // Head into other snake body (skip tail)
                for (int i = 0; i < other.Body.Count - 1; i++)
                    if (other.Body[i].X == next.X && other.Body[i].Y == next.Y)
                    { toKill.Add(p); break; }
            }
        }

        // Kill players
        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        foreach (var p in toKill)
        { p.Dead = true; p.DiedAtMs = now; }

        // Move surviving snakes
        var foodsToRemove = new List<RattlerFood>();
        foreach (var p in alive)
        {
            if (p.Dead) continue;
            var next = nextHeads[p];

            var eaten = room.Foods.FirstOrDefault(f => f.X == next.X && f.Y == next.Y);
            bool grow = eaten != null;
            if (eaten != null)
            {
                p.Score += eaten.Value;
                foodsToRemove.Add(eaten);
            }

            p.Body.Insert(0, next);
            if (!grow) p.Body.RemoveAt(p.Body.Count - 1);
        }

        foreach (var f in foodsToRemove) room.Foods.Remove(f);

        // Replace eaten food and occasional bonus
        foreach (var _ in foodsToRemove) SpawnFood(room);
        if (room.TickNumber % 50 == 0 && room.Foods.Count < 5) SpawnFood(room, bonus: true);

        // Check game-over conditions
        var stillAlive = room.Players.Where(p => !p.Dead).ToList();
        bool anyHumanAlive = stillAlive.Any(p => !p.IsBot);
        bool allHumansDead = room.Players.Where(p => !p.IsBot).All(p => p.Dead);

        // Game ends when all humans are dead (or last player standing in SP)
        bool shouldEnd = allHumansDead
            || (room.IsSinglePlayer && stillAlive.Count == 0)
            || (stillAlive.Count == 0);

        if (shouldEnd) { EndGame(room); return true; }
        return false;
    }

    public static void EndGame(RattlerRoom room)
    {
        room.IsOver = true;

        // Winner: highest score among all players; ties broken by survival time
        var sorted = room.Players
            .OrderByDescending(p => p.Score)
            .ThenBy(p => p.DiedAtMs ?? long.MaxValue)
            .ToList();

        for (int i = 0; i < sorted.Count; i++)
        {
            sorted[i].FinishRank = i + 1;
            sorted[i].FinishedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }
        room.WinnerName = sorted[0].Name;
    }

    public static void SpawnFood(RattlerRoom room, bool bonus = false)
    {
        int w = room.GridW, h = room.GridH;
        var occupied = new HashSet<(int, int)>();
        foreach (var p in room.Players) foreach (var b in p.Body) occupied.Add((b.X, b.Y));
        foreach (var f in room.Foods) occupied.Add((f.X, f.Y));

        for (int tries = 0; tries < 200; tries++)
        {
            int x = Random.Shared.Next(1, w - 1);
            int y = Random.Shared.Next(1, h - 1);
            if (!occupied.Contains((x, y)))
            {
                int value = bonus
                    ? (Random.Shared.Next(4) == 0 ? 10 : 3)
                    : 1;
                room.Foods.Add(new RattlerFood { X = x, Y = y, Value = value });
                return;
            }
        }
    }

    public static (int dx, int dy) DirDelta(RattlerDir d) => d switch
    {
        RattlerDir.Up    => (0, -1),
        RattlerDir.Down  => (0,  1),
        RattlerDir.Left  => (-1, 0),
        RattlerDir.Right => (1,  0),
        _ => (0, 0)
    };

    public static bool IsOpposite(RattlerDir a, RattlerDir b) =>
        (a == RattlerDir.Up    && b == RattlerDir.Down)  ||
        (a == RattlerDir.Down  && b == RattlerDir.Up)    ||
        (a == RattlerDir.Left  && b == RattlerDir.Right) ||
        (a == RattlerDir.Right && b == RattlerDir.Left);

    public static RattlerClientState BuildStateFor(RattlerRoom room, string playerName)
    {
        int myIndex = room.Players.FindIndex(p => p.Name == playerName);
        return new RattlerClientState
        {
            GridW        = room.GridW,
            GridH        = room.GridH,
            IsOver       = room.IsOver,
            WinnerName   = room.WinnerName,
            TickNumber   = room.TickNumber,
            Started      = room.Started,
            IsSinglePlayer = room.IsSinglePlayer,
            IsHost       = room.HostName == playerName,
            MyIndex      = myIndex,
            Foods        = [.. room.Foods],
            Players      = [.. room.Players.Select(p => new RattlerClientPlayer
            {
                Name       = p.Name,
                IsBot      = p.IsBot,
                Dead       = p.Dead,
                Score      = p.Score,
                Length     = p.Body.Count,
                FinishRank = p.FinishRank,
                BodyX      = [.. p.Body.Select(b => b.X)],
                BodyY      = [.. p.Body.Select(b => b.Y)],
            })]
        };
    }

    private static void UpdateBotDirection(RattlerRoom room, RattlerPlayer bot)
    {
        var head = bot.Body[0];
        var dirs = new[] { RattlerDir.Up, RattlerDir.Down, RattlerDir.Left, RattlerDir.Right };

        // Build obstacles (everything except own tail)
        var occupied = new HashSet<(int, int)>();
        foreach (var p in room.Players)
            for (int i = 0; i < p.Body.Count - 1; i++)
                occupied.Add((p.Body[i].X, p.Body[i].Y));

        var safeDirs = dirs.Where(d =>
        {
            if (IsOpposite(d, bot.Dir)) return false;
            var (dx, dy) = DirDelta(d);
            int nx = head.X + dx, ny = head.Y + dy;
            if (nx < 0 || nx >= room.GridW || ny < 0 || ny >= room.GridH) return false;
            return !occupied.Contains((nx, ny));
        }).ToList();

        if (safeDirs.Count == 0) return;

        // Prefer direction toward highest-value food
        if (room.Foods.Count > 0)
        {
            var bestFood = room.Foods.MaxBy(f => f.Value);
            if (bestFood != null)
            {
                RattlerDir? preferred = null;
                int bestDist = int.MaxValue;
                foreach (var d in safeDirs)
                {
                    var (dx, dy) = DirDelta(d);
                    int dist = Math.Abs(bestFood.X - (head.X + dx)) + Math.Abs(bestFood.Y - (head.Y + dy));
                    if (dist < bestDist) { bestDist = dist; preferred = d; }
                }
                if (preferred.HasValue) { bot.NextDir = preferred.Value; return; }
            }
        }

        // Keep current direction if safe, else pick random safe
        if (safeDirs.Contains(bot.Dir)) bot.NextDir = bot.Dir;
        else bot.NextDir = safeDirs[Random.Shared.Next(safeDirs.Count)];
    }

    public static string GetBotName(int index) =>
        BotNames[index % BotNames.Length];
}
