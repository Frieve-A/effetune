Component notices from Netty tag netty-4.2.19.Final, license/.
Source: https://github.com/netty/netty/tree/netty-4.2.19.Final/license

The application redistributes these Netty classes and their incorporated code:
- logging/MessageFormatter and logging adapters: SLF4J (QOS.ch)
- WebSocket frame codecs: Webbit
- Bzip2 codecs and Bzip2DivSufSort: jbzip2 and libdivsufsort
- shaded queues: JCTools
- Base64 codecs: Robert Harder's public-domain Base64
- ThreadLocalRandom and ConcurrentSkipListIntObjMultimap: JSR-166
- NetUtil: Apache Harmony Inet6Util
- FastLz: William Kinney's jfastlz
- Protobuf varint frame codecs: Google Protocol Buffers
- WebSocket Utf8Validator: Bjoern Hoehrmann's UTF-8 decoder

LICENSE.utf8-validator.txt reproduces the incorporated notice from
codec-http/src/main/java/io/netty/handler/codec/http/websocketx/Utf8Validator.java
at the same pinned tag. The other component texts come from license/.
Apache Commons Lang portions retain the Apache 2.0 license and attribution in
the accompanying Netty LICENSE and NOTICE.

Netty's own LICENSE and NOTICE accompany this directory. Optional compression,
native transport and HTTP/2 dependencies not present in the APK are not included.
