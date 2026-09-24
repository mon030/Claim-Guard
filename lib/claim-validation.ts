import { z } from "zod";

/** Shared browser/API limit; change here rather than silently clamping an amount. */
export const MAX_CLAIM_AMOUNT = 250_000;
export const claimAmountSchema = z.number({ error: "Enter a valid claim amount." }).finite()
  .gt(0, "Claim amount must be greater than $0.")
  .max(MAX_CLAIM_AMOUNT, `Claim amount must be no more than $${MAX_CLAIM_AMOUNT.toLocaleString("en-US")}.`);
