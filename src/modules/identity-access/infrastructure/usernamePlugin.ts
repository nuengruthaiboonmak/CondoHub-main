import { username } from 'better-auth/plugins/username';
import type { UsernamePluginWithoutDisplayUsername } from 'better-auth/plugins/username';

export function createUsernamePlugin(): UsernamePluginWithoutDisplayUsername {
  return username({
    displayUsername: false,
    immutableUsername: true,
    usernameNormalization: (value) => value.trim().toLowerCase(),
  });
}
