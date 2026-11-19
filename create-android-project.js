const fs = require('fs');
const path = require('path');

console.log('🚀 Menyiapkan file proyek Android native Kantin Kita...');

// Buat direktori yang dibutuhkan
const dirs = [
  'android/app/src/main/java/com/kantinkita/pos',
  'android/app/src/main/res/values',
  'android/app/src/main/res/mipmap-hdpi',
  'android/app/src/main/res/mipmap-mdpi',
  'android/app/src/main/res/mipmap-xhdpi',
  'android/app/src/main/res/mipmap-xxhdpi'
];
dirs.forEach(d => fs.mkdirSync(d, { recursive: true }));

// 1. settings.gradle
fs.writeFileSync('android/settings.gradle', `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "KantinKita"
include ':app'
`);

// 2. build.gradle (root)
fs.writeFileSync('android/build.gradle', `buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath 'com.android.tools.build:gradle:8.2.2'
    }
}

task clean(type: Delete) {
    delete rootProject.buildDir
}
`);

// 3. app/build.gradle
fs.writeFileSync('android/app/build.gradle', `plugins {
    id 'com.android.application'
}

android {
    namespace 'com.kantinkita.pos'
    compileSdk 34

    defaultConfig {
        applicationId "com.kantinkita.pos"
        minSdk 21
        targetSdk 34
        versionCode 1
        versionName "1.0.0"
    }

    buildTypes {
        release {
            minifyEnabled false
        }
        debug {
            applicationIdSuffix ""
        }
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }
}

dependencies {
    implementation 'androidx.appcompat:appcompat:1.6.1'
    implementation 'com.google.android.material:material:1.11.0'
    implementation 'androidx.webkit:webkit:1.10.0'
}
`);

// 4. AndroidManifest.xml
fs.writeFileSync('android/app/src/main/AndroidManifest.xml', `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="Kantin Kita"
        android:roundIcon="@mipmap/ic_launcher"
        android:supportsRtl="true"
        android:theme="@style/Theme.KantinKita"
        android:usesCleartextTraffic="true">
        <activity
            android:name=".MainActivity"
            android:configChanges="orientation|screenSize|screenLayout|keyboardHidden"
            android:exported="true"
            android:windowSoftInputMode="adjustResize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>

</manifest>
`);

// 5. styles.xml
fs.writeFileSync('android/app/src/main/res/values/styles.xml', `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="Theme.KantinKita" parent="android:Theme.NoTitleBar.Fullscreen">
        <item name="android:windowBackground">#0f172a</item>
    </style>
</resources>
`);

// 6. MainActivity.java
fs.writeFileSync('android/app/src/main/java/com/kantinkita/pos/MainActivity.java', `package com.kantinkita.pos;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        );

        webView = new WebView(this);
        setContentView(webView);

        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setAllowFileAccess(true);
        ws.setUseWideViewPort(true);
        ws.setLoadWithOverviewMode(true);
        ws.setMediaPlaybackRequiresUserGesture(false);

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient());

        webView.loadUrl("https://pos-kantin.onrender.com");
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
`);

// 7. Salin Icon Logo
const logoSrc = 'public/logo.png';
if (fs.existsSync(logoSrc)) {
  const iconTargets = [
    'android/app/src/main/res/mipmap-mdpi/ic_launcher.png',
    'android/app/src/main/res/mipmap-hdpi/ic_launcher.png',
    'android/app/src/main/res/mipmap-xhdpi/ic_launcher.png',
    'android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png'
  ];
  iconTargets.forEach(t => fs.copyFileSync(logoSrc, t));
  console.log('✅ Icon logo resmi berhasil dipasang.');
}

console.log('✅ Semua file proyek Android berhasil dibuat!');

