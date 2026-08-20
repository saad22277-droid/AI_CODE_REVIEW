const FORM_LABELS = {
  username: 'Username',
  password: 'Password',
  confirmPassword: 'Confirm password',
};

function getLabel(key) {
  return FORM_LABELS[key] || key;
}

module.exports = { FORM_LABELS, getLabel };
