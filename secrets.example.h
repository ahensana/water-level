// Copy this file to secrets.h in the same folder as the sketch and fill it in.
// secrets.h is git-ignored: never commit the real key.
//
// DEVICE_INGEST_KEY must be the same value stored on the functions with
//   firebase functions:secrets:set DEVICE_INGEST_KEY
// Use letters and digits only (it goes in a URL), e.g. `openssl rand -hex 24`.
#pragma once

#define INGEST_URL "https://asia-south1-water-level-ae453.cloudfunctions.net/ingest"
#define DEVICE_INGEST_KEY "replace-with-your-device-key"
