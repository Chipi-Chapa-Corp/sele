import { initializePreferences, showPreferenceFailure } from './preferences'

void initializePreferences()
  .then(() => import('./bootstrap'))
  .catch(showPreferenceFailure)
