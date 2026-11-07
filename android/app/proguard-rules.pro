# Inboxies release (R8) rules. Libraries ship their own consumer rules (OkHttp,
# Firebase, Credential Manager / googleid, AndroidX, kotlinx.serialization); these cover
# what's specific to this app plus missing-class warnings for optional dependencies.

# Readable crash stacks (map with the uploaded mapping.txt).
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# ── kotlinx.serialization ────────────────────────────────────────────────────
# Models are decoded by generated serializers looked up from the companion; keep
# the companions / serializer() accessors and the generated $$serializer classes.
-keepattributes RuntimeVisibleAnnotations,AnnotationDefault,InnerClasses,Signature
-if @kotlinx.serialization.Serializable class **
-keepclassmembers class <1> {
    static <1>$Companion Companion;
}
-if @kotlinx.serialization.Serializable class ** {
    static **$* *;
}
-keepclassmembers class <2>$<3> {
    kotlinx.serialization.KSerializer serializer(...);
}
-if @kotlinx.serialization.Serializable class ** {
    public static ** INSTANCE;
}
-keepclassmembers class <1> {
    public static <1> INSTANCE;
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class co.inboxies.app.**$$serializer { *; }
-keepclassmembers class co.inboxies.app.** {
    *** Companion;
}
-keepclasseswithmembers class co.inboxies.app.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# ── Optional / compile-only references in dependencies ─────────────────────
# jsoup's optional regex engine.
-dontwarn com.google.re2j.**
# Tink (EncryptedSharedPreferences) annotation-only references.
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**
# OkHttp's optional TLS providers.
-dontwarn org.bouncycastle.**
-dontwarn org.conscrypt.**
-dontwarn org.openjsse.**

# ── Glance widget (AVE-150) ──────────────────────────────────────────────────
# actionRunCallback<T>() stores the class name and recreates it reflectively.
-keep class * implements androidx.glance.appwidget.action.ActionCallback { <init>(); }
