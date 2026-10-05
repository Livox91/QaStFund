export type EmailMessage = Readonly<{
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey?: string;
}>;

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
