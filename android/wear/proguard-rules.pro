# Inboxies for Wear OS release (R8) rules. Libraries ship their own consumer rules
# (OkHttp, AndroidX, Play services, kotlinx.serialization); these cover the app's models.

-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# kotlinx.serialization models (same rules as :app).
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
-keep,includedescriptorclasses class co.inboxies.wear.**$$serializer { *; }
-keepclassmembers class co.inboxies.wear.** {
    *** Companion;
}

# OkHttp's optional TLS providers.
-dontwarn org.bouncycastle.jsse.**
-dontwarn org.conscrypt.**
-dontwarn org.openjsse.**
# Tink (security-crypto) compile-only annotations.
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**
