/** Provider key status (never the keys themselves) and non-secret settings. */
export default defineApiHandler(() => {
  const { secrets, settings } = useAnyGen()
  return { providers: secrets.status(), settings: settings.getAll() }
})
