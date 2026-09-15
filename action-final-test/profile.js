function getDisplayName(user) {
  return user.profile.displayName.trim();
}

module.exports = { getDisplayName };