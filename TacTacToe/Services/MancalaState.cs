namespace TacTacToe.Services;

public class MancalaRoom
{
    public string Id { get; set; } = "";
    public string HostConnectionId { get; set; } = "";
    public string HostName { get; set; } = "";
    public List<MancalaPlayer> Players { get; set; } = [];
    public MancalaSettings Settings { get; set; } = new();
    public bool Started { get; set; }
    public bool IsOver { get; set; }
    public bool IsSinglePlayer { get; set; }
    public string? WinnerName { get; set; }
    // Board: [0..5] P1 pits, [6] P1 store, [7..12] P2 pits, [13] P2 store
    public int[] Board { get; set; } = new int[14];
    public int CurrentPlayerIndex { get; set; }
    public bool ExtraTurn { get; set; }
    public int LastPitIndex { get; set; } = -1;
    public long StartedAtMs { get; set; }
    public bool SessionsSaved { get; set; }
}

public class MancalaSettings
{
    public string RoomName { get; set; } = "Mancala";
    public int MaxPlayers { get; set; } = 2;
    public int StonesPerPit { get; set; } = 4;
}

public class MancalaPlayer
{
    public string ConnectionId { get; set; } = "";
    public string Name { get; set; } = "";
    public bool Connected { get; set; } = true;
    public bool IsBot { get; set; }
    public string AiDifficulty { get; set; } = "regular";
}

public class MancalaHint
{
    public bool HintAvailable { get; set; }
    public int PitIndex { get; set; } = -1;
    public string Description { get; set; } = "";
}

public static class MancalaEngine
{
    public const int P1Store = 6;
    public const int P2Store = 13;

    public static int[] CreateBoard(int stonesPerPit = 4)
    {
        var board = new int[14];
        for (int i = 0; i < 6; i++) board[i] = stonesPerPit;
        board[6] = 0;
        for (int i = 7; i < 13; i++) board[i] = stonesPerPit;
        board[13] = 0;
        return board;
    }

    public static void StartGame(MancalaRoom room)
    {
        room.Started = true;
        room.IsOver = false;
        room.WinnerName = null;
        room.SessionsSaved = false;
        room.Board = CreateBoard(room.Settings.StonesPerPit);
        room.CurrentPlayerIndex = 0;
        room.ExtraTurn = false;
        room.LastPitIndex = -1;
        room.StartedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    }

    // Returns the next index counter-clockwise, skipping the opponent's store
    private static int NextIndex(int current, int currentPlayer)
    {
        int next = (current + 1) % 14;
        // Skip opponent's store
        int opponentStore = currentPlayer == 0 ? P2Store : P1Store;
        if (next == opponentStore) next = (next + 1) % 14;
        return next;
    }

    // Check if a pit belongs to the given player
    public static bool IsPlayerPit(int pitIndex, int playerIndex)
    {
        if (playerIndex == 0) return pitIndex >= 0 && pitIndex <= 5;
        return pitIndex >= 7 && pitIndex <= 12;
    }

    // Opposite pit index (0↔12, 1↔11, 2↔10, 3↔9, 4↔8, 5↔7)
    private static int OppositePit(int pitIndex)
    {
        return 12 - pitIndex;
    }

    // Validate and perform a move. Returns: (extraTurn, captured, landedIndex, valid)
    public static (bool ExtraTurn, bool Captured, int LandedIndex, bool Valid) MakeMove(MancalaRoom room, int pitIndex)
    {
        int playerIndex = room.CurrentPlayerIndex;

        // Validate pit belongs to current player and has stones
        if (!IsPlayerPit(pitIndex, playerIndex)) return (false, false, -1, false);
        if (room.Board[pitIndex] <= 0) return (false, false, -1, false);

        int stones = room.Board[pitIndex];
        room.Board[pitIndex] = 0;

        int current = pitIndex;
        while (stones > 0)
        {
            current = NextIndex(current, playerIndex);
            room.Board[current]++;
            stones--;
        }

        int landedIndex = current;
        room.LastPitIndex = landedIndex;

        // Extra turn: last stone in own store
        int myStore = playerIndex == 0 ? P1Store : P2Store;
        if (landedIndex == myStore)
        {
            // Check if game is over first
            if (CheckGameOver(room)) return (false, false, landedIndex, true);
            return (true, false, landedIndex, true);
        }

        // Capture: last stone in own empty pit (and had just 1 now = was empty before)
        bool capture = false;
        if (IsPlayerPit(landedIndex, playerIndex) && room.Board[landedIndex] == 1)
        {
            int opposite = OppositePit(landedIndex);
            if (room.Board[opposite] > 0)
            {
                room.Board[myStore] += room.Board[opposite] + 1;
                room.Board[opposite] = 0;
                room.Board[landedIndex] = 0;
                capture = true;
            }
        }

        if (CheckGameOver(room)) return (false, capture, landedIndex, true);

        return (false, capture, landedIndex, true);
    }

    // Returns true if game is over; applies end-of-game sweep if so
    public static bool CheckGameOver(MancalaRoom room)
    {
        bool p1Empty = Enumerable.Range(0, 6).All(i => room.Board[i] == 0);
        bool p2Empty = Enumerable.Range(7, 6).All(i => room.Board[i] == 0);

        if (!p1Empty && !p2Empty) return false;

        // Sweep remaining stones
        for (int i = 0; i < 6; i++) { room.Board[P1Store] += room.Board[i]; room.Board[i] = 0; }
        for (int i = 7; i < 13; i++) { room.Board[P2Store] += room.Board[i]; room.Board[i] = 0; }

        room.IsOver = true;
        if (room.Board[P1Store] > room.Board[P2Store]) room.WinnerName = room.Players[0].Name;
        else if (room.Board[P2Store] > room.Board[P1Store]) room.WinnerName = room.Players.Count > 1 ? room.Players[1].Name : null;
        else room.WinnerName = null; // tie
        return true;
    }

    // Valid moves for the current player
    public static List<int> GetValidMoves(MancalaRoom room, int playerIndex)
    {
        var moves = new List<int>();
        if (playerIndex == 0)
        {
            for (int i = 0; i < 6; i++) if (room.Board[i] > 0) moves.Add(i);
        }
        else
        {
            for (int i = 7; i < 13; i++) if (room.Board[i] > 0) moves.Add(i);
        }
        return moves;
    }

    public static MancalaHint ComputeHint(MancalaRoom room, int playerIndex)
    {
        // Prefer a move that gives an extra turn
        int myStore = playerIndex == 0 ? P1Store : P2Store;
        var validMoves = GetValidMoves(room, playerIndex);
        if (validMoves.Count == 0)
            return new MancalaHint { HintAvailable = false, Description = "No moves available." };

        // Try to find a move that lands in own store
        foreach (int pit in validMoves)
        {
            int stones = room.Board[pit];
            int landIdx = pit;
            int skipStore = playerIndex == 0 ? P2Store : P1Store;
            for (int s = 0; s < stones; s++)
            {
                landIdx = (landIdx + 1) % 14;
                if (landIdx == skipStore) landIdx = (landIdx + 1) % 14;
            }
            if (landIdx == myStore)
            {
                return new MancalaHint { HintAvailable = true, PitIndex = pit, Description = $"Play pit {(playerIndex == 0 ? pit + 1 : pit - 6)} — lands in your store for an extra turn!" };
            }
        }

        // Try to find a capture move
        foreach (int pit in validMoves)
        {
            int stones = room.Board[pit];
            int skipStore = playerIndex == 0 ? P2Store : P1Store;
            int landIdx = pit;
            for (int s = 0; s < stones; s++)
            {
                landIdx = (landIdx + 1) % 14;
                if (landIdx == skipStore) landIdx = (landIdx + 1) % 14;
            }
            if (IsPlayerPit(landIdx, playerIndex) && room.Board[landIdx] == 0)
            {
                int opp = OppositePit(landIdx);
                if (room.Board[opp] > 0)
                    return new MancalaHint { HintAvailable = true, PitIndex = pit, Description = $"Play pit {(playerIndex == 0 ? pit + 1 : pit - 6)} — captures {room.Board[opp]} stones!" };
            }
        }

        // Default: pick pit with most stones
        int best = validMoves.OrderByDescending(p => room.Board[p]).First();
        int display = playerIndex == 0 ? best + 1 : best - 6;
        return new MancalaHint { HintAvailable = true, PitIndex = best, Description = $"Play pit {display} ({room.Board[best]} stones)." };
    }

    // Bot AI: evaluate moves and return best pit
    public static int BotMove(MancalaRoom room, int playerIndex, string difficulty)
    {
        var moves = GetValidMoves(room, playerIndex);
        if (moves.Count == 0) return -1;

        if (difficulty == "regular")
        {
            // Random move
            return moves[Random.Shared.Next(moves.Count)];
        }

        // Hard: prefer extra turn > capture > most stones
        int myStore = playerIndex == 0 ? P1Store : P2Store;
        int skipStore = playerIndex == 0 ? P2Store : P1Store;

        foreach (int pit in moves)
        {
            int landIdx = pit;
            int stones = room.Board[pit];
            for (int s = 0; s < stones; s++)
            {
                landIdx = (landIdx + 1) % 14;
                if (landIdx == skipStore) landIdx = (landIdx + 1) % 14;
            }
            if (landIdx == myStore) return pit;
        }

        foreach (int pit in moves)
        {
            int landIdx = pit;
            int stones = room.Board[pit];
            for (int s = 0; s < stones; s++)
            {
                landIdx = (landIdx + 1) % 14;
                if (landIdx == skipStore) landIdx = (landIdx + 1) % 14;
            }
            if (IsPlayerPit(landIdx, playerIndex) && room.Board[landIdx] == 0)
            {
                int opp = OppositePit(landIdx);
                if (room.Board[opp] > 0) return pit;
            }
        }

        return moves.OrderByDescending(p => room.Board[p]).First();
    }
}
