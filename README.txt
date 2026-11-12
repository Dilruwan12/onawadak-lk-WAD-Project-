ONAWADAK.LK - Firebase real-data version

FILES
- index.html
- style.css
- script.js
- firebase-config.js
- provider-profile.html
- provider-profile.css
- provider-profile.js
- firestore.rules

FEATURES ADDED
1. Fake worker array removed. Providers are loaded from Firestore users collection.
2. Default nearby radius is 10 km; 25/50 km options remain.
3. Browser geolocation + Haversine distance sorting/filtering.
4. Worker registration includes Leaflet map pin selection and current-location button.
5. Worker phone Call button uses tel: and opens a supported phone dialer.
6. Forgot Password uses Firebase sendPasswordResetEmail().
7. Service requests are saved to Firestore requests collection.
8. Provider dashboard loads and updates real Firestore requests.

FIREBASE SETUP REQUIRED
A. Firebase Console > Authentication > Sign-in method > enable Email/Password.
B. Firestore Database > Rules > paste firestore.rules and Publish.
C. Authentication > Settings > Authorized domains > add your deployed domain (onawadak.lk / www.onawadak.lk as needed).
D. Password reset emails use Firebase Authentication templates. Customize them in Authentication > Templates > Password reset.

IMPORTANT
- Geolocation works on HTTPS or localhost. Deploy the site over HTTPS.
- A desktop browser may not have a phone dialer; tel: works best on phones or devices with a calling app.
- Existing old workers without lat/lng will not appear. Ask them to re-register or add numeric lat and lng fields to their Firestore user document.
- For production privacy, consider separating public worker profiles from private user/contact data instead of making all user documents public.
