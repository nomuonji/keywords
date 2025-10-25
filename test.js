try {
  require('@keywords/blogger');
  console.log('Successfully imported @keywords/blogger');
} catch (e) {
  console.error('Failed to import @keywords/blogger', e);
}

try {
  require('@keywords/blogger/media');
  console.log('Successfully imported @keywords/blogger/media');
} catch (e) {
  console.error('Failed to import @keywords/blogger/media', e);
}