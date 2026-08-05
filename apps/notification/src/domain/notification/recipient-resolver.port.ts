export interface Recipient {
  email: string;
  phone: string;
  pushToken: string;
}

export interface RecipientResolverPort {
  resolve(userId: string): Promise<Recipient>;
}

export const RECIPIENT_RESOLVER = Symbol('RecipientResolverPort');
