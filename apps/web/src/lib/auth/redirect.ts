const invitationPath = /^\/invite$/;

export function loginDestination(returnTo: string | undefined) {
  return returnTo && invitationPath.test(returnTo) ? returnTo : "/overview";
}
