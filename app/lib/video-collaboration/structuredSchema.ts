export type VideoPlanningJsonSchema = Record<string, unknown>;

function validateStructuredValue(value: unknown, schema: VideoPlanningJsonSchema, path = "$response"): string[] {
  const errors: string[] = [];
  const type = schema.type;
  if (type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [`${path} must be an object`];
    const record = value as Record<string, unknown>;
    const properties = (schema.properties || {}) as Record<string, VideoPlanningJsonSchema>;
    for (const key of (schema.required || []) as string[]) {
      if (!(key in record)) errors.push(`${path}.${key} is required`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!(key in properties)) errors.push(`${path}.${key} is not allowed`);
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (key in record) errors.push(...validateStructuredValue(record[key], childSchema, `${path}.${key}`));
    }
  } else if (type === "array") {
    if (!Array.isArray(value)) return [`${path} must be an array`];
    if (typeof schema.minItems === "number" && value.length < schema.minItems) errors.push(`${path} has too few items`);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) errors.push(`${path} has too many items`);
    const itemSchema = schema.items as VideoPlanningJsonSchema | undefined;
    if (itemSchema) value.forEach((item, index) => errors.push(...validateStructuredValue(item, itemSchema, `${path}[${index}]`)));
  } else if (type === "string") {
    if (typeof value !== "string") return [`${path} must be a string`];
    if (typeof schema.minLength === "number" && value.length < schema.minLength) errors.push(`${path} is too short`);
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) errors.push(`${path} is too long`);
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errors.push(`${path} has an invalid value`);
  } else if (type === "integer" || type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value) || (type === "integer" && !Number.isInteger(value))) {
      return [`${path} must be a ${type}`];
    }
    if (typeof schema.minimum === "number" && value < schema.minimum) errors.push(`${path} is below minimum`);
    if (typeof schema.maximum === "number" && value > schema.maximum) errors.push(`${path} is above maximum`);
  } else if (type === "boolean" && typeof value !== "boolean") {
    errors.push(`${path} must be a boolean`);
  }
  return errors;
}

export function assertStructuredVideoPlanningResponse(value: unknown, schema: VideoPlanningJsonSchema) {
  const errors = validateStructuredValue(value, schema);
  if (errors.length) throw new Error(`Schema validation failed: ${errors.slice(0, 5).join("; ")}`);
}
