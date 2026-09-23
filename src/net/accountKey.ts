/**
 * The public half of the key the accounts service signs player passes with. Public
 * by design: it can only check a signature, never make one. Printed on the
 * droplet by `python3 /opt/opspanel/accounts.py pubkey`; replacing the key
 * there means rebuilding with the new one here.
 */
export const ACCOUNT_KEY: JsonWebKey = {
  kty: 'EC',
  crv: 'P-256',
  x: 'xo89N6EkWGdDIjQFvC0hJcE4WX9biojjX29gR3131j8',
  y: 'na7yvxWWt1UzHNT1wTQbvdTi3eTUtR3EX5DnrjFic1c',
};
