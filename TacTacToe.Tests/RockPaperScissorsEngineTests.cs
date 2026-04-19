using TacTacToe.Services;
using Xunit;

namespace TacTacToe.Tests;

public class RockPaperScissorsEngineTests
{
    private readonly RockPaperScissorsEngine _engine = new();

    [Fact]
    public void ReverseLogic_ShouldFlipOutcome()
    {
        Assert.Equal(1, RockPaperScissorsEngine.CompareMoves(Move.Rock, Move.Scissors, reverse: false));
        Assert.Equal(-1, RockPaperScissorsEngine.CompareMoves(Move.Rock, Move.Scissors, reverse: true));
    }

    [Fact]
    public void LockIn_ShouldForceOpponentPreviousMove()
    {
        var player = new PlayerState();
        var opponent = new PlayerState { LastMove = Move.Rock };

        var result = _engine.ResolveRound(new RoundInput
        {
            Player = player,
            Opponent = opponent,
            PlayerMove = Move.Scissors,
            OpponentMove = Move.Scissors,
            PlayerPowerUp = PowerUp.LockIn
        });

        Assert.Equal(Move.Rock, result.OpponentMove);
        Assert.Equal(2, result.Winner);
    }

    [Fact]
    public void Shield_ShouldConvertLossToTie()
    {
        var player = new PlayerState();
        var opponent = new PlayerState();

        var result = _engine.ResolveRound(new RoundInput
        {
            Player = player,
            Opponent = opponent,
            PlayerMove = Move.Rock,
            OpponentMove = Move.Paper,
            PlayerPowerUp = PowerUp.Shield
        });

        Assert.Equal(0, result.Winner);
        Assert.Equal(0, result.PlayerPointsAwarded);
        Assert.Equal(0, result.OpponentPointsAwarded);
    }

    [Fact]
    public void Sabotage_ShouldDisableOpponentPowerUp()
    {
        var player = new PlayerState();
        var opponent = new PlayerState();

        var result = _engine.ResolveRound(new RoundInput
        {
            Player = player,
            Opponent = opponent,
            PlayerMove = Move.Rock,
            OpponentMove = Move.Paper,
            PlayerPowerUp = PowerUp.Sabotage,
            OpponentPowerUp = PowerUp.Shield
        });

        Assert.Equal(2, result.Winner);
        Assert.Empty(result.OpponentPowerUpsUsed);
    }

    [Fact]
    public void Randomizer_ShouldApproximateTwentyFivePercentIncreasedWinChance()
    {
        const int trials = 20000;
        const double weightedRandomWinBoost = 1.25d;
        const double toleranceMargin = 0.03d;
        var random = new Random(42);
        var wins = 0;

        for (var i = 0; i < trials; i++)
        {
            var move = RockPaperScissorsEngine.GetWeightedRandomMove(Move.Rock, reverse: false, random);
            if (move == Move.Paper) wins++;
        }

        var observed = wins / (double)trials;
        var expected = (1d / 3d) * weightedRandomWinBoost;

        Assert.InRange(observed, expected - toleranceMargin, expected + toleranceMargin);
    }
}
