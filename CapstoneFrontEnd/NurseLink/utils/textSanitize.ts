// Strips anything that isn't a letter, space, hyphen, or apostrophe — so a
// name field can't hold a digit, while names like "O'Brien" or "Dela Cruz"
// or "Mary-Jane" still work. Applied as the nurse types, not only on submit.
export function sanitizeName(v: string): string {
  return v.replace(/[^a-zA-Z\s'-]/g, '');
}
