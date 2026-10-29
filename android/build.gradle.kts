buildscript {
    repositories { google(); mavenCentral() }
    dependencies {
        // AGP supports a newer KGP on its classpath; keep build-cache deserialization patched.
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.21")
        constraints {
            // AGP's tooling graph otherwise selects versions with published security advisories.
            add("classpath", "com.google.guava:guava:33.7.2-jre")
            add("classpath", "org.apache.commons:commons-lang3:3.21.0")
            add("classpath", "org.bitbucket.b_c:jose4j:0.9.7")
            add("classpath", "org.bouncycastle:bcpkix-jdk18on:1.86")
            add("classpath", "org.bouncycastle:bcprov-jdk18on:1.86")
            add("classpath", "org.bouncycastle:bcutil-jdk18on:1.86")
            add("classpath", "org.jdom:jdom2:2.0.6.1")
        }
    }
}

plugins {
    id("com.android.application") version "9.5.0" apply false
}
