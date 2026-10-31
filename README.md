# Doodle Duet 💞

A draw-and-guess game for two. No accounts, no backend: the drawing travels inside the share link.

## How a round works

1. **Play**, enter your name, and pick **Artist** or **Guesser**.
2. **Artist** picks Easy / Medium / Tricky, gets a secret word (2 re-rolls), and doodles it with a finger.
3. **Done, send it** packs the strokes into a link (`#d=…`) and opens the phone's share sheet.
4. **Guesser** taps the link, opens the envelope, watches the doodle redraw itself stroke by stroke, and guesses.
   - 3 hearts. Each wrong guess costs a heart and reveals a letter.
   - Near misses ("so close!") are free, up to 3 times. Small typos on longer words count as correct.
   - Score = difficulty × hearts left, +1 bonus on a 3+ streak. Points go to the shared team score.
5. The guesser reacts with an emoji and a note, then either **sends the result back** (`#r=…`) or **draws one back**. The next doodle link carries the result too.
6. A guesser can go first: **Ask your partner to draw** sends an invite link (`#j=…`).

## Finger drawing

- `touch-action: none` and touch `preventDefault` on the pad stop scroll, zoom, and the iOS magnifier.
- Moves under 2.2px are ignored for touch (fingertip jitter), and points pass through a light moving average, then render as curves through midpoints.
- Coalesced pointer events keep fast swipes smooth.
- **Two-finger tap = undo.** A second finger that lands on a long stroke (a resting palm) ends that stroke instead.
- Thicker brushes (3 sizes), 9 colours, eraser, undo, and clear (clear can be undone).

## Under the hood

- Static files only (`index.html`, `styles.css`, `js/`), with no build step.
- Strokes are stored on a 1000×1000 grid, simplified (Ramer–Douglas–Peucker), delta + varint encoded, deflated with `CompressionStream`, and base64url'd into the URL **hash**. The hash is never sent to a server.
- The secret word is obfuscated in the link (not encrypted). Peeking is possible if someone tries hard.
- `localStorage` keeps your name, team score, guess progress (reloading doesn't reset hearts), and a gallery of your last 40 doodles.
