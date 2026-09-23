export interface ClaimOption {
  claimId: string; claimant: string; amount: number; date: string;
  location: string; category: string; narrative: string; customerEmail: string;
  photos: { photoId: string; filename: string }[];
  unavailableReason: string | null;
}
export interface UiConfiguration { demoAccessRequired: boolean; llmConfigured: boolean; }
