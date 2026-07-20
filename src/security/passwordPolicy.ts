const COMMON_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', 'password', 'password1', 'motdepasse',
  'azertyuiop', 'qwertyuiop', 'admin123', 'welcome123', 'bienvenue123', 'nfs123456',
]);

export const passwordPolicyError = (value: unknown) => {
  const password = String(value || '');
  if (password.length < 15 || password.length > 128) {
    return 'Le mot de passe doit contenir entre 15 et 128 caractères.';
  }
  if (COMMON_PASSWORDS.has(password.trim().toLowerCase())) {
    return 'Ce mot de passe est trop courant ou compromis. Choisissez une phrase de passe unique.';
  }
  return null;
};

export const passwordIsStrong = (value: unknown) => passwordPolicyError(value) === null;
