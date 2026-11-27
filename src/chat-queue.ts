/** What of pi's session `unqueue` reaches. */
export interface QueueOf {
  getSteeringMessages(): readonly string[];
  getFollowUpMessages(): readonly string[];
  clearQueue(): { steering: string[]; followUp: string[] };
  steer(text: string, images?: undefined, options?: { source: "extension" }): Promise<unknown>;
  followUp(text: string, images?: undefined, options?: { source: "extension" }): Promise<unknown>;
}

/**
 * A message taken out of the session's queue - read by another agent, a skill's - the rest put back as they were, in
 * order. pi takes none out alone: the queue is emptied and filled again. False when it is not queued.
 */
export async function unqueue(session: QueueOf, text: string): Promise<boolean> {
  if (!session.getSteeringMessages().includes(text) && !session.getFollowUpMessages().includes(text)) return false;
  const { steering, followUp } = session.clearQueue();
  const at = steering.indexOf(text);
  if (at !== -1) steering.splice(at, 1);
  else followUp.splice(followUp.indexOf(text), 1);
  // Put back as turri's, not typed: what watches the person's input does not take them again.
  for (const message of steering) await session.steer(message, undefined, { source: "extension" });
  for (const message of followUp) await session.followUp(message, undefined, { source: "extension" });
  return true;
}
