using System.Collections.ObjectModel;

namespace TacTacToe.Services;

public enum Move
{
    Rock,
    Paper,
    Scissors
}

public enum PowerUp
{
    Shield,
    DoubleStrike,
    Reveal,
    Reverse,
    LockIn,
    Randomizer,
    Sabotage,
    Charge
}

public class PlayerState
{
    public int Score { get; set; }
    public HashSet<PowerUp> AvailablePowerUps { get; set; } = [];
    public Dictionary<PowerUp, int> Cooldowns { get; set; } = [];
    public Move? LastMove { get; set; }
    public int Coins { get; set; }
}

public class RoundResult
{
    public required Move? PlayerMove { get; init; }
    public required Move? OpponentMove { get; init; }
    public required IReadOnlyList<PowerUp> PlayerPowerUpsUsed { get; init; }
    public required IReadOnlyList<PowerUp> OpponentPowerUpsUsed { get; init; }
    public required int Winner { get; init; } // 0 = tie, 1 = player, 2 = opponent
    public required int PlayerPointsAwarded { get; init; }
    public required int OpponentPointsAwarded { get; init; }
    public required bool ReverseActive { get; init; }
}

public sealed class RoundInput
{
    public required Move PlayerMove { get; init; }
    public required Move OpponentMove { get; init; }
    public PowerUp? PlayerPowerUp { get; init; }
    public PowerUp? OpponentPowerUp { get; init; }
    public required PlayerState Player { get; init; }
    public required PlayerState Opponent { get; init; }
}

public sealed class RockPaperScissorsEngine
{
    private static readonly ReadOnlyCollection<Move> Moves = Array.AsReadOnly([Move.Rock, Move.Paper, Move.Scissors]);

    public RoundResult ResolveRound(RoundInput input, Random? random = null)
    {
        random ??= Random.Shared;

        var playerMove = input.PlayerMove;
        var opponentMove = input.OpponentMove;
        var playerPower = input.PlayerPowerUp;
        var opponentPower = input.OpponentPowerUp;

        // 1) Sabotage
        if (playerPower == PowerUp.Sabotage && opponentPower != PowerUp.Sabotage) opponentPower = null;
        if (opponentPower == PowerUp.Sabotage && playerPower != PowerUp.Sabotage) playerPower = null;

        // 2) Lock-In
        if (playerPower == PowerUp.LockIn && input.Opponent.LastMove is Move forcedOpponentMove)
            opponentMove = forcedOpponentMove;
        if (opponentPower == PowerUp.LockIn && input.Player.LastMove is Move forcedPlayerMove)
            playerMove = forcedPlayerMove;

        // 3) Reveal (UI-only: no scoring impact)

        // 4) Reverse
        var reverseActive = playerPower == PowerUp.Reverse || opponentPower == PowerUp.Reverse;

        // 5) Randomizer
        if (playerPower == PowerUp.Randomizer)
            playerMove = GetWeightedRandomMove(opponentMove, reverseActive, random);
        if (opponentPower == PowerUp.Randomizer)
            opponentMove = GetWeightedRandomMove(playerMove, reverseActive, random);

        // 6) Shield and 7) Double Strike applied after base result is known
        // 8) Charge
        var playerCharged = playerPower == PowerUp.Charge;
        var opponentCharged = opponentPower == PowerUp.Charge;

        var compare = 0;
        if (playerCharged && opponentCharged)
        {
            compare = 0;
        }
        else if (playerCharged)
        {
            compare = -1;
        }
        else if (opponentCharged)
        {
            compare = 1;
        }
        else
        {
            compare = CompareMoves(playerMove, opponentMove, reverseActive);
        }

        if (compare < 0 && playerPower == PowerUp.Shield) compare = 0;
        if (compare > 0 && opponentPower == PowerUp.Shield) compare = 0;

        var playerPoints = 0;
        var opponentPoints = 0;
        var winner = 0;

        if (compare > 0)
        {
            winner = 1;
            playerPoints = playerPower == PowerUp.DoubleStrike ? 2 : 1;
            input.Player.Score += playerPoints;
            input.Player.Coins += playerPoints;
        }
        else if (compare < 0)
        {
            winner = 2;
            opponentPoints = opponentPower == PowerUp.DoubleStrike ? 2 : 1;
            input.Opponent.Score += opponentPoints;
            input.Opponent.Coins += opponentPoints;
        }

        input.Player.LastMove = playerMove;
        input.Opponent.LastMove = opponentMove;

        return new RoundResult
        {
            PlayerMove = playerMove,
            OpponentMove = opponentMove,
            PlayerPowerUpsUsed = playerPower is null ? [] : [playerPower.Value],
            OpponentPowerUpsUsed = opponentPower is null ? [] : [opponentPower.Value],
            Winner = winner,
            PlayerPointsAwarded = playerPoints,
            OpponentPointsAwarded = opponentPoints,
            ReverseActive = reverseActive
        };
    }

    public static int CompareMoves(Move playerMove, Move opponentMove, bool reverse)
    {
        if (playerMove == opponentMove) return 0;

        var playerWins = (playerMove, opponentMove) is
            (Move.Rock, Move.Scissors) or
            (Move.Scissors, Move.Paper) or
            (Move.Paper, Move.Rock);

        if (reverse) playerWins = !playerWins;
        return playerWins ? 1 : -1;
    }

    public static Move GetCounterMove(Move predicted, bool reverse)
    {
        if (!reverse)
        {
            return predicted switch
            {
                Move.Rock => Move.Paper,
                Move.Paper => Move.Scissors,
                _ => Move.Rock
            };
        }

        return predicted switch
        {
            Move.Rock => Move.Scissors,
            Move.Paper => Move.Rock,
            _ => Move.Paper
        };
    }

    public static Move GetWeightedRandomMove(Move opponentMove, bool reverse, Random random)
    {
        var winning = GetCounterMove(opponentMove, reverse);
        var pool = new List<Move>();
        for (var i = 0; i < 10; i++) pool.Add(winning);

        foreach (var move in Moves)
        {
            if (move != winning)
            {
                for (var i = 0; i < 7; i++) pool.Add(move);
            }
        }

        return pool[random.Next(pool.Count)];
    }
}
