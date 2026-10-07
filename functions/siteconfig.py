"""Fixed facts about the deployment that every function shares."""

PROJECT_ID = "water-level-ae453"
DATABASE_URL = "https://water-level-ae453-default-rtdb.asia-southeast1.firebasedatabase.app"
STORAGE_BUCKET = "water-level-ae453.firebasestorage.app"

# Mumbai: closest Cloud Functions region to Meghalaya.
REGION = "asia-south1"
TIMEZONE = "Asia/Kolkata"

SITE_NAME = "Umiam Reservoir"
# Lake centroid (Wikipedia, Umiam Lake: 25.6532 N, 91.8843 E). Used as the seed
# for finding the reservoir outline and its catchment; it does not need to be
# the dam itself.
LAKE_LAT = 25.6532
LAKE_LON = 91.8843

# Published catchment area for Umiam (220-225 km2). The function derives its own
# catchment from HydroBASINS and records both, so a bad derivation is visible.
PUBLISHED_CATCHMENT_KM2 = 220.0

# Database paths written by the functions. Rules make /satellite public-read and
# client-write-false; the Admin SDK used here bypasses rules.
PATH_READINGS = "water_monitor/current"
PATH_SAT = "satellite"
