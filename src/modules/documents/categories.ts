export const employmentLetters = [
  "APPOINTMENT_LETTER",
  "INCREMENT_LETTER",
  "PROMOTION_LETTER",
] as const;
export const isEmploymentLetter = (category: string) =>
  (employmentLetters as readonly string[]).includes(category);
