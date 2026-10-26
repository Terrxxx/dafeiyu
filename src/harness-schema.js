// Harness's value DSL supports a subset of JSON Schema. Range/length limits
// remain enforced by SocialTools; mention them in the model-facing description.
export function harnessValue(value) {
  const { minimum, maximum, minItems, maxItems, minLength, maxLength, ...result } = value;
  const limits = Object.entries({ minimum, maximum, minItems, maxItems, minLength, maxLength }).filter(([, v]) => v !== undefined);
  if (limits.length) result.description = [result.description, limits.map(([k, v]) => `${k}=${v}`).join(', ')].filter(Boolean).join('; ');
  if (result.items) result.items = harnessValue(result.items);
  return result;
}
export function harnessParameters(parameters) {
  return Object.fromEntries(Object.entries(parameters.properties).map(([key, value]) =>
    [key, { ...harnessValue(value), ...(parameters.required.includes(key) ? { required: true } : {}) }]));
}
