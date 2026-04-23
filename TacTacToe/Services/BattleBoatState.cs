namespace TacTacToe.Services;

public class BattleBoatRoom
{
    public string Id { get; set; } = "";
    public string HostConnectionId { get; set; } = "";
    public string HostName { get; set; } = "";
    public List<BattleBoatPlayer> Players { get; set; } = [];
    public bool Started { get; set; }
    public bool IsOver { get; set; }
    public string? WinnerName { get; set; }
    public BattleBoatSettings Settings { get; set; } = new();
    public int CurrentPlayerIndex { get; set; }
    public long StartedAtMs { get; set; }
}

public class BattleBoatSettings
{
    public string RoomName { get; set; } = "Battle Boat Match";
    public int MaxPlayers { get; set; } = 2;
}

public class BattleBoatPlayer
{
    public string ConnectionId { get; set; } = "";
    public string Name { get; set; } = "";
    public bool Connected { get; set; } = true;
    public bool FleetPlaced { get; set; }
    public List<BattleBoatShip> Fleet { get; set; } = [];
    public List<string> Shots { get; set; } = [];
    public List<string> HitShots { get; set; } = [];   // subset of Shots that were hits
    public bool Lost { get; set; }
}

public class BattleBoatShip
{
    public string Key { get; set; } = "";
    public string Name { get; set; } = "";
    public int Size { get; set; }
    public List<int[]> Cells { get; set; } = [];
    public int Hits { get; set; }
    public bool Sunk { get; set; }
}
