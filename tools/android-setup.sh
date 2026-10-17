#!/usr/bin/env bash
# Creates the Android project and patches it for a fullscreen, landscape, screen-on horror game.
# Used by the GitHub Action and for local builds (needs Node 20+, JDK 21, Android SDK).
set -euo pipefail
npm install --no-save @capacitor/core@7 @capacitor/cli@7 @capacitor/android@7
[ -d android ] || npx cap add android
MANIFEST=android/app/src/main/AndroidManifest.xml
grep -q screenOrientation "$MANIFEST" || sed -i 's/<activity/<activity android:screenOrientation="sensorLandscape" android:keepScreenOn="true"/' "$MANIFEST"
STYLES=android/app/src/main/res/values/styles.xml
grep -q windowFullscreen "$STYLES" || sed -i 's#<item name="windowNoTitle">true</item>#<item name="windowNoTitle">true</item>\n        <item name="android:windowFullscreen">true</item>\n        <item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>#g' "$STYLES"
npx cap sync android
echo "Android project ready. Build with: cd android && ./gradlew assembleDebug"
