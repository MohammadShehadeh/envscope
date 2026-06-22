export function connect() {
  const url = process.env.DATABASE_URL;
  return { url };
}
