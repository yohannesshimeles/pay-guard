const phaseTwoPath =
  /^(businesses(?:\/register|\/[0-9a-f-]+\/status|\/[0-9a-f-]+\/branches(?:\/[0-9a-f-]+)?|\/[0-9a-f-]+\/branches\/[0-9a-f-]+\/users(?:\/[0-9a-f-]+\/remove)?|\/[0-9a-f-]+\/branches\/[0-9a-f-]+\/settlement-accounts(?:\/[0-9a-f-]+\/deactivate)?)?|banks)$/i;

export function isAllowedPhaseTwoPath(path: string) {
  return phaseTwoPath.test(path);
}
