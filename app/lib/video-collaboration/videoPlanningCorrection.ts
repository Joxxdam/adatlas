export async function runWithSingleVideoPlanningCorrection<T>(input: {
  requestInitial: () => Promise<T>;
  isValid: (value: T) => boolean;
  requestCorrection: (value: T) => Promise<T>;
}) {
  let value = await input.requestInitial();
  let correctionCount = 0;
  if (!input.isValid(value)) {
    value = await input.requestCorrection(value);
    correctionCount = 1;
  }
  return { value, correctionCount };
}
