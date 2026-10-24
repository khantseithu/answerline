export function defaultSuiteFor(agentSlug: string | undefined, suites: string[]) {
  return agentSlug && suites.includes(agentSlug) ? agentSlug : suites[0];
}
