export class CareError extends Error {
  accessJournalRecorded = false;
  constructor(public status: number, public code: string, message: string) { super(message); }
}
