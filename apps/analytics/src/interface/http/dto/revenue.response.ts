/** One day's revenue + confirmed-order count bucket. */
export class RevenuePointResponse {
  day!: string;
  revenueCents!: number;
  orderCount!: number;
}
