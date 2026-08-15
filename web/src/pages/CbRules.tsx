import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Topbar } from '../components/Topbar';

export function CbRules() {
  useEffect(() => { document.title = 'Format rules — Card Blind'; }, []);
  return (
    <>
      <Topbar title="Card Blind" sub="Format rules" />
      <div className="container">
        <div className="panel">
          <h1>How Card Blind works</h1>
          <p className="hint">Four Card Blind (4CB) is a Magic: The Gathering thought-experiment
            format from the early-2000s forum era, grown out of 3-Card Blind. Nobody shuffles up:
            you build a tiny deck in secret, it gets revealed alongside everyone else's, and each
            pairing is worked out assuming perfect play from both sides. The skill is entirely in
            deckbuilding — reading the metagame, dodging the banlist, and finding four cards that
            beat more tables than they lose to. Everything below describes the classic 4-card game;
            your league's hand size, format and highlander rule are set by its creator.</p>
        </div>

        <div className="panel">
          <h2 style={{ marginTop: 0 }}>1 · Building your deck</h2>
          <p className="hint">
            • Your deck is exactly <b>N cards</b> (4 in classic 4CB; this site allows 2–10 per league).<br />
            • Every card must be <b>legal in the league's format</b> (Legacy, Vintage, Modern,
            Premodern, Pioneer, Standard or Pauper — checked against Scryfall when you submit).<br />
            • Cards on the <b>round's banlist</b> are not allowed. The banlist is shown on the
            Round tab before you submit and is frozen per round — the admin updates it between
            rounds.<br />
            • With <b>highlander</b> on (the classic rule), at most 1 copy of each card, except
            basic lands — you may run several Islands. Without highlander, duplicates are fine,
            but Vintage-restricted cards are still capped at 1 copy.<br />
            • There is <b>no sideboard and no mulligan</b> — what you submit is exactly what you
            play, in every match of the round.</p>
        </div>

        <div className="panel">
          <h2 style={{ marginTop: 0 }}>2 · The blind submission</h2>
          <p className="hint">
            • Each round has a <b>submission deadline</b>. Until then you can submit and resubmit
            freely; only your latest deck counts.<br />
            • Submissions are <b>completely hidden</b> — no other player, not even the league
            admin, can see your deck before the reveal. That's the "blind": you are guessing at
            the metagame, not reacting to it.<br />
            • At the deadline the decks <b>reveal automatically</b> (the admin can reveal early
            once everyone has submitted). If you miss the deadline you simply <b>sit the round
            out</b> — no matches, 0 points, back in next round.</p>
        </div>

        <div className="panel">
          <h2 style={{ marginTop: 0 }}>3 · Playing a game</h2>
          <p className="hint">A "game" follows normal Magic rules with a few format-defining changes:</p>
          <p className="hint">
            • Your whole deck is your <b>opening hand</b>. Your library is <b>empty</b> — but you
            do <b>not</b> lose for failing to draw from an empty library. Draw steps and "draw a
            card" effects simply do nothing (an empty-library draw is not a loss here).<br />
            • There is <b>no hidden information</b>: both decks are public, so hands, face-down
            cards and any card in a hidden zone are treated as known to both players.<br />
            • <b>No luck</b>: any random effect (coin flips, dice, random discard…) resolves in
            the way <b>worst for the controller</b> of the effect. If your plan needs to win a
            flip, your plan loses the flip.<br />
            • Both players are assumed to play <b>perfectly</b> — every decision, in every line,
            made with full knowledge of both decks. A game "happens" the way it would between
            two flawless players.<br />
            • If the game goes <b>infinite</b> or reaches a stalemate neither perfect player can
            break (very common — e.g. two decks that can't interact), the game is a <b>draw</b>.
            Double draws are a normal, expected result in this format.</p>
          <p className="hint">In practice most matches are settled by talking the lines through with
            your opponent — physically playing it out is allowed but rarely necessary. Perfect play
            includes choosing whether and when to act first: the player on the play moves first and
            that asymmetry is exactly why every match is two games.</p>
        </div>

        <div className="panel">
          <h2 style={{ marginTop: 0 }}>4 · Matches &amp; scoring</h2>
          <p className="hint">After the reveal, <b>every deck plays every other deck</b> once
            (round-robin). A match is <b>two games</b>: game 1 with one player on the play, game 2
            with the other. Match points from your perspective:</p>
          <div className="grid-wrap"><table className="cb-table">
            <thead><tr><th>Your two games</th><th>Points</th></tr></thead>
            <tbody>
              <tr><td>Win + Win</td><td><b>6</b></td></tr>
              <tr><td>Win + Draw</td><td><b>4</b></td></tr>
              <tr><td>Win + Loss</td><td><b>2</b></td></tr>
              <tr><td>Draw + Draw</td><td><b>2</b></td></tr>
              <tr><td>Draw + Loss</td><td><b>1</b></td></tr>
              <tr><td>Loss + Loss</td><td><b>0</b></td></tr>
            </tbody>
          </table></div>
          <p className="hint">The player with the <b>highest total across all matches wins the
            round</b>. League standings simply add up your round totals.</p>
        </div>

        <div className="panel">
          <h2 style={{ marginTop: 0 }}>5 · Reporting results</h2>
          <p className="hint">
            • Both players of a match <b>report the two game results themselves</b> from the Round
            tab. When the two reports agree, the result locks in and points are awarded.<br />
            • If the reports <b>conflict</b>, the match is flagged, the league admin is notified,
            and the admin sets the final result. You can amend your report any time before the
            result is confirmed.<br />
            • Every match has a private <b>notes thread</b> — visible only to the two players and
            the admin — for agreeing on lines, scheduling, or leaving your reasoning for the
            admin in case of a dispute.</p>
        </div>

        <div className="panel">
          <h2 style={{ marginTop: 0 }}>6 · The league loop &amp; the banlist</h2>
          <p className="hint">
            • A league runs a planned number of rounds (the admin can extend it). Each round:
            banlist snapshot → blind submissions → reveal → matches → results → standings.<br />
            • Between rounds the admin curates the <b>custom banlist</b>. The classic 4CB
            tradition: <b>every card in the round winner's deck is banned</b> for the rest of
            the league, and many groups also ban any card that appeared in half the decks. That
            churn is the heart of the format — last round's answer is next round's dead card.
            The tradition is a convention, not enforced software — your admin decides.<br />
            • New players can join mid-league and simply start with the next submission window.
            Dropped players stay in the standings but get no new matches.</p>
        </div>

        <div className="panel">
          <h2 style={{ marginTop: 0 }}>7 · Judgment calls</h2>
          <p className="hint">"Perfect play" occasionally leaves genuine rules puzzles — that's half
            the fun. Talk it out in the match notes first; if you still disagree, report what you
            each believe and let the admin rule. Useful tie-breaker questions: Does either deck
            have a forced win on its own? Who is forced to act first, and does acting first lose?
            Can the defender always hold up the answer? If neither player can ever profitably act,
            it's a draw.</p>
          <p className="hint" style={{ marginTop: 10 }}>
            <Link to="/4cb">← Back to Card Blind</Link> · <Link to="/dashboard">Dashboard</Link></p>
        </div>
      </div>
    </>
  );
}
