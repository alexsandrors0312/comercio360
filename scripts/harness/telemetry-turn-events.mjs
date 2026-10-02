/** Select the one complete root turn expected by the one-shot DSH runner. */
export function firstCompleteTurnEvents(events) {
  const turn = [];
  let started = false;
  for (const event of events) {
    if (!started) {
      if (event.type !== "turn/start") continue;
      started = true;
    }
    turn.push(event);
    if (event.type === "turn/end") return turn;
  }
  return [];
}
