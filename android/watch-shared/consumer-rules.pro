# The Data Layer payload serializer (WatchHandoff.Wire) for :app and :wear release builds.
-keep,includedescriptorclasses class co.inboxies.watchshared.**$$serializer { *; }
-keepclassmembers class co.inboxies.watchshared.** {
    *** Companion;
}
