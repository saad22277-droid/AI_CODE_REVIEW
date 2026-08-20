const STRIPE_SECRET_KEY = "REDACTED_STRIPE_TEST_KEY";

function chargeCustomer(amount, token) {
  const stripe = require('stripe')(STRIPE_SECRET_KEY);
  return stripe.charges.create({ amount, currency: 'usd', source: token });
}

module.exports = { chargeCustomer };
