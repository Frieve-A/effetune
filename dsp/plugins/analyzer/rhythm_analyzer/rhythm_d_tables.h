// Generated from the reference front end, detector and learned detector model. Do not edit.
// Sources: rhythm_d_tables.provenance.json.
#pragma once
#include <cstdint>

namespace effetune::plugins::analyzer::rhythm_d {

inline constexpr std::uint32_t kLo = 1u, kHi = 342u, kSubBands = 24u;
inline constexpr std::uint32_t kBandBins[6] = {1, 5, 4, 86, 85, 342};

inline constexpr std::uint32_t kSubBandBins[48] = {
    1,  2,  2,  3,  3,  4,   4,   5,   5,   6,   6,   7,   7,   9,   9,   11,
    11, 13, 13, 16, 16, 20,  20,  24,  24,  30,  30,  37,  37,  45,  45,  56,
    56, 69, 69, 86, 86, 108, 108, 136, 136, 171, 171, 216, 216, 271, 271, 342};

inline constexpr std::uint32_t kSubBandBand[24] = {0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
                                                   1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2};

inline constexpr double kSubBandWeight[24] = {
    0x1.0000000000000p+0, 0x1.0000000000000p+0, 0x1.0000000000000p+0, 0x1.0000000000000p+0,
    0x1.0000000000000p+0, 0x1.0000000000000p+0, 0x1.0000000000000p-1, 0x1.0000000000000p-1,
    0x1.0000000000000p-1, 0x1.5555555555555p-2, 0x1.0000000000000p-2, 0x1.0000000000000p-2,
    0x1.5555555555555p-3, 0x1.2492492492492p-3, 0x1.0000000000000p-3, 0x1.745d1745d1746p-4,
    0x1.3b13b13b13b14p-4, 0x1.e1e1e1e1e1e1ep-5, 0x1.745d1745d1746p-5, 0x1.2492492492492p-5,
    0x1.d41d41d41d41dp-6, 0x1.6c16c16c16c17p-6, 0x1.29e4129e4129ep-6, 0x1.cd85689039b0bp-7};

inline constexpr double kNorm1024 = 0x1.f3fffff123639p+1, kParseval1024 = 0x1.5555553c3c1d4p-18;

inline constexpr double kNorm2048 = 0x1.f3fffff295c08p+0, kParseval2048 = 0x1.55555544c643bp-20;

inline constexpr double kNorm4096 = 0x1.f3fffff5dd374p-1, kParseval4096 = 0x1.55555548c1e44p-22;

inline constexpr double kCFloor[3] = {0x1.e01d34e1a20dcp-6, 0x1.644608b64fe43p-6,
                                      0x1.24646d218eb1dp-8};

inline constexpr double kCC[3] = {0x1.6b2f1a9fbe76dp+4, 0x1.e3923a29c779ap+2, 0x1.018c7e28240b8p+2};

inline constexpr double kCFloorF[3] = {0x1.07a2170e78ea0p-7, 0x1.042b91bf4fc56p-8,
                                       0x1.36cff22cf3f28p-9};

inline constexpr double kCCF[3] = {0x1.6670d844d013bp+5, 0x1.9d604189374bcp+1,
                                   0x1.025aee631f8a1p+1};

inline constexpr double kCD[3] = {0x1.b6d7ea2798000p-9, 0x1.af3b4f3078000p-8, 0x1.c5ef831270000p-8};

inline constexpr std::int32_t kRefractory[3] = {5, 5, 4};

inline constexpr std::uint32_t kFChannel[3] = {0, 1, 0};

inline constexpr double kLogitTheta[3] = {-0x1.4a851baf27b71p-2, -0x1.2716011df4657p+0,
                                          -0x1.ede65f58845bdp-3};

inline constexpr double kTheta[3] = {0x1.ae147ae147ae1p-2, 0x1.eb851eb851eb8p-3,
                                     0x1.c28f5c28f5c29p-2};

inline constexpr std::int32_t kWf = 375, kCap = 375, kRelease = 3;
inline constexpr double kCandidateMin = 0x1.0000000000000p-2, kGateDb = -0x1.1800000000000p+6,
                        kLevelFloor = -0x1.2c00000000000p+8, kLMin = -0x1.2c00000000000p+7;
inline constexpr double kLn10Over20 = 0x1.d791c5f888823p-4, kLogMilli = -0x1.ba18a998fffa0p+2;
inline constexpr double kFrameS = 0x1.5d867c3ece2a5p-9, kRiseC = 0x1.0bba4865ca5f3p-8,
                        kRiseAlpha = 0x1.999999999999ap-4, kRiseAlphaQuarter = 0x1.1feb33c1c381ep-1;
inline constexpr double kDbFloor = 0x1.79ca10c924223p-67;
inline constexpr std::uint32_t kPool = 4u, kZStop = 44u;
inline constexpr double kStatLLow[49] = {
    -0x1.e67be76c8b439p+6, -0x1.dd020c49ba5e3p+6, -0x1.d326e978d4fdfp+6, -0x1.c8bd70a3d70a4p+6,
    -0x1.bede353f7ced9p+6, -0x1.b4fced916872bp+6, -0x1.abec8b4395810p+6, -0x1.a170a3d70a3d7p+6,
    -0x1.96f6c8b439581p+6, -0x1.8d20c49ba5e35p+6, -0x1.82c083126e979p+6, -0x1.790624dd2f1aap+6,
    -0x1.6fac083126e98p+6, -0x1.655e353f7ced9p+6, -0x1.5b3f7ced91687p+6, -0x1.5080000000000p+6,
    -0x1.473b645a1cac1p+6, -0x1.3d5604189374cp+6, -0x1.339374bc6a7f0p+6, -0x1.286f9db22d0e5p+6,
    -0x1.1f46a7ef9db23p+6, -0x1.15116872b020cp+6, -0x1.0b22d0e560419p+6, -0x1.013e76c8b4396p+6,
    -0x1.ee45a1cac0831p+5, -0x1.db1a9fbe76c8bp+5, -0x1.c6cac083126e9p+5, -0x1.b1e5604189375p+5,
    -0x1.9e1cac083126fp+5, -0x1.893f7ced91687p+5, -0x1.75c8b43958106p+5, -0x1.62c6a7ef9db23p+5,
    -0x1.4ed70a3d70a3dp+5, -0x1.3a9ba5e353f7dp+5, -0x1.25b020c49ba5ep+5, -0x1.12f7ced916873p+5,
    -0x1.fc83126e978d5p+4, -0x1.d40c49ba5e354p+4, -0x1.abba5e353f7cfp+4, -0x1.82a7ef9db22d1p+4,
    -0x1.5cb4395810625p+4, -0x1.34c083126e979p+4, -0x1.0cac083126e98p+4, -0x1.c8ed916872b02p+3,
    -0x1.76147ae147ae1p+3, -0x1.29ba5e353f7cfp+3, -0x1.ae978d4fdf3b6p+2, -0x1.1000000000000p+2,
    -0x1.c624dd2f1a9fcp+0};

inline constexpr double kStatLogEdLow[49] = {
    -0x1.27d84716ec264p+3, -0x1.1f1efe77d00efp+3, -0x1.15ba3104a42e9p+3, -0x1.0d11ab89b214cp+3,
    -0x1.01ae4fc1c9a73p+3, -0x1.f4e2b72b660ebp+2, -0x1.eabdd4bfb1535p+2, -0x1.d1163149073a0p+2,
    -0x1.bff17fec88b17p+2, -0x1.ad36c637445a9p+2, -0x1.9799826d7d88ap+2, -0x1.83df6792ad7a1p+2,
    -0x1.7011224f1eaa7p+2, -0x1.616d79cac04c8p+2, -0x1.5191b8afce5a0p+2, -0x1.40fec3a28f52fp+2,
    -0x1.3125d086092f3p+2, -0x1.20830160b74d5p+2, -0x1.0d6ba4422e92ap+2, -0x1.f6e1289118261p+1,
    -0x1.e02287a4637adp+1, -0x1.bb9f8f4ec5315p+1, -0x1.aba985a261033p+1, -0x1.95791f828d6d1p+1,
    -0x1.81971c0c0b3c4p+1, -0x1.6172ff17b5cb0p+1, -0x1.56014afb560cep+1, -0x1.45d80dbc0459fp+1,
    -0x1.42e4ee39e6ff3p+1, -0x1.2deb52fdbc766p+1, -0x1.2815caea3be5bp+1, -0x1.20f23d42ec787p+1,
    -0x1.1e8b07dc66e18p+1, -0x1.24ef77694a3b1p+1, -0x1.1afa6dd13db30p+1, -0x1.1e996dde868d0p+1,
    -0x1.183c315b56b5ap+1, -0x1.0ef80e329d244p+1, -0x1.15dc7c8a7b74ap+1, -0x1.1ba20f707c74ap+1,
    -0x1.12b680620a0cdp+1, -0x1.12cc24f98353ep+1, -0x1.12d4dc0396591p+1, -0x1.106fac4b09bdep+1,
    -0x1.146d518d1be7bp+1, -0x1.1339c4ea27744p+1, -0x1.16f975aa4b73ap+1, -0x1.1457839fd2e1dp+1,
    -0x1.14246c14a28c2p+1};

inline constexpr double kStatLogEfLow[49] = {
    -0x1.51b2c15b63627p+3, -0x1.47fd40fa0afc7p+3, -0x1.3fa1a7e315cc7p+3, -0x1.378c90c774cfap+3,
    -0x1.2b6ccc9ef9f4cp+3, -0x1.24232896317cap+3, -0x1.1f505815c9e71p+3, -0x1.12010afb1d511p+3,
    -0x1.09b2ca7e35609p+3, -0x1.fed8c1cd3c363p+2, -0x1.eb0e1130df9c2p+2, -0x1.d6c5b892a0014p+2,
    -0x1.c449d0d93605fp+2, -0x1.b52bb9e664e0cp+2, -0x1.a501456c9383ap+2, -0x1.94f702ff114dap+2,
    -0x1.84a8d96e213c0p+2, -0x1.71f83405bd227p+2, -0x1.60f97d2df6dacp+2, -0x1.4f9b798052dfcp+2,
    -0x1.42e79c645f2f8p+2, -0x1.31a090fe9feb1p+2, -0x1.2825da32ee7c3p+2, -0x1.1d159414ea0acp+2,
    -0x1.14ccf4df72aeep+2, -0x1.046ac3c36d5b5p+2, -0x1.fe043e289c20ep+1, -0x1.ee7d6af7bb469p+1,
    -0x1.e872e2ee1da8bp+1, -0x1.d7256a171d906p+1, -0x1.ce43b20827857p+1, -0x1.c80cac02c4858p+1,
    -0x1.c739564e88285p+1, -0x1.cba7e33a27cadp+1, -0x1.c26a1fc2b6404p+1, -0x1.c648f17ad4cdcp+1,
    -0x1.be9c60f65746bp+1, -0x1.b464f44061058p+1, -0x1.bb2d03a498393p+1, -0x1.c382b68f20993p+1,
    -0x1.b6e24f67b5f3dp+1, -0x1.b978b1f6548a5p+1, -0x1.bb62fa30289bap+1, -0x1.b88d043851414p+1,
    -0x1.ba3077f25b517p+1, -0x1.b7e4b64beb783p+1, -0x1.bbc8a9bc20dd9p+1, -0x1.bc6320ce72b21p+1,
    -0x1.baca04a7db6bbp+1};

inline constexpr double kStatLMid[49] = {
    -0x1.aff1a9fbe76c9p+6, -0x1.a5ed916872b02p+6, -0x1.9bf1a9fbe76c9p+6, -0x1.91e6666666666p+6,
    -0x1.87fef9db22d0ep+6, -0x1.7e1374bc6a7f0p+6, -0x1.73e147ae147aep+6, -0x1.69f2b020c49bap+6,
    -0x1.5fd916872b021p+6, -0x1.560624dd2f1aap+6, -0x1.4bf7ced916873p+6, -0x1.42051eb851eb8p+6,
    -0x1.37e978d4fdf3bp+6, -0x1.2dc5a1cac0831p+6, -0x1.23eb851eb851fp+6, -0x1.19e76c8b43958p+6,
    -0x1.0fe6666666666p+6, -0x1.060f5c28f5c29p+6, -0x1.f7e76c8b43958p+5, -0x1.e3f3b645a1cacp+5,
    -0x1.cffbe76c8b439p+5, -0x1.bbe5604189375p+5, -0x1.a800000000000p+5, -0x1.93e978d4fdf3bp+5,
    -0x1.80189374bc6a8p+5, -0x1.6c26e978d4fdfp+5, -0x1.57d4fdf3b645ap+5, -0x1.440e560418937p+5,
    -0x1.2fd4fdf3b645ap+5, -0x1.1bbe76c8b4396p+5, -0x1.080c49ba5e354p+5, -0x1.e72f1a9fbe76dp+4,
    -0x1.bf9999999999ap+4, -0x1.97df3b645a1cbp+4, -0x1.6fd70a3d70a3dp+4, -0x1.48147ae147ae1p+4,
    -0x1.1ffbe76c8b439p+4, -0x1.f06a7ef9db22dp+3, -0x1.a028f5c28f5c3p+3, -0x1.4f53f7ced9168p+3,
    -0x1.ff3b645a1cac1p+2, -0x1.61374bc6a7efap+2, -0x1.7fbe76c8b4396p+1, -0x1.fae147ae147aep-2,
    0x1.02f1a9fbe76c9p+1,  0x1.2083126e978d5p+2,  0x1.c1eb851eb851fp+2,  0x1.306a7ef9db22dp+3,
    0x1.7fd70a3d70a3dp+3};

inline constexpr double kStatLogEdMid[49] = {
    -0x1.0d9b7d23ff6afp+3, -0x1.03b6ef0b70d8ep+3, -0x1.f4f228b0fc1b7p+2, -0x1.e270440d50c66p+2,
    -0x1.d06c64fd8ca95p+2, -0x1.bf1d629e5cdf1p+2, -0x1.ac50422560f2cp+2, -0x1.9a67cd5a250afp+2,
    -0x1.87065ba666b21p+2, -0x1.75af04faf19cbp+2, -0x1.624737dd1aa1ap+2, -0x1.5039ba56b877bp+2,
    -0x1.3f30d7f31cc02p+2, -0x1.2ce5dfbe7a592p+2, -0x1.1bd800a8810bap+2, -0x1.0ac28ff3a34abp+2,
    -0x1.f53805a4105f5p+1, -0x1.d260eaccffc99p+1, -0x1.b0005820e9f9ap+1, -0x1.9228384659cd6p+1,
    -0x1.74a14bcae0b85p+1, -0x1.5a46a15b0ecddp+1, -0x1.3e8fca1f121abp+1, -0x1.2772505369611p+1,
    -0x1.13926ea5f37bap+1, -0x1.ffc4164d62ba9p+0, -0x1.dc1d93467b215p+0, -0x1.c4a91833dc6dbp+0,
    -0x1.a80f5cab73ec5p+0, -0x1.957cf82f97c75p+0, -0x1.8689ed5ab4786p+0, -0x1.76c3ea60e0257p+0,
    -0x1.711f3404a8748p+0, -0x1.671a8769fc3f9p+0, -0x1.63fb4f362ea20p+0, -0x1.5e275530f9f73p+0,
    -0x1.58dd613ab77f5p+0, -0x1.585efb5b9bb99p+0, -0x1.5803932f62aa3p+0, -0x1.514c930544c01p+0,
    -0x1.5388b013c61acp+0, -0x1.5249a8bd417a4p+0, -0x1.508c00cfacadep+0, -0x1.505a4d143b33ep+0,
    -0x1.50ba5af292c31p+0, -0x1.4f2a7ab1b4e19p+0, -0x1.4ecbe83de4715p+0, -0x1.5329a673ab6dap+0,
    -0x1.5001962a9676ep+0};

inline constexpr double kStatLogEfMid[49] = {
    -0x1.3a7fc1960eff8p+3, -0x1.312a8150fb65fp+3, -0x1.27f93f7d50ed2p+3, -0x1.1ee7030a3c45cp+3,
    -0x1.156181c25c0c6p+3, -0x1.0c8a4ee724c37p+3, -0x1.0374b62e182f6p+3, -0x1.f46b8e7781694p+2,
    -0x1.e1bb44adbecc2p+2, -0x1.d02b6e4b587d8p+2, -0x1.bd48f9c2313f5p+2, -0x1.aaff0e6ea2f03p+2,
    -0x1.997e6d7bcd97cp+2, -0x1.878dc5e068ebcp+2, -0x1.75fe5400174a3p+2, -0x1.652c960bcc64dp+2,
    -0x1.5401f8431787bp+2, -0x1.433bfb5c8ac1cp+2, -0x1.32d62100f977fp+2, -0x1.234336efac74bp+2,
    -0x1.148c62cb4dd33p+2, -0x1.06e6a85e58aa3p+2, -0x1.f27d32d4c7f51p+1, -0x1.db6af264b48ebp+1,
    -0x1.c6e03750b9035p+1, -0x1.b3c8bee918312p+1, -0x1.a2d17451283cfp+1, -0x1.9668f5d189158p+1,
    -0x1.897d9cffc8873p+1, -0x1.802c00cc47695p+1, -0x1.77d57950f8ef4p+1, -0x1.70809c68d5265p+1,
    -0x1.6e0c9d496ee00p+1, -0x1.69a0b7122cc0ap+1, -0x1.66e4e6b4a3067p+1, -0x1.6408487c88832p+1,
    -0x1.61f3ac7709c03p+1, -0x1.61ec8dc5d4913p+1, -0x1.5f3a3543d5f85p+1, -0x1.5eb00fde3b792p+1,
    -0x1.5db5616463222p+1, -0x1.5e224c614244bp+1, -0x1.5dec6e7a34cb5p+1, -0x1.5ca9683c58b26p+1,
    -0x1.5d4df1eff855cp+1, -0x1.5d5d90c5c4b3cp+1, -0x1.5cabdbdcd3afcp+1, -0x1.5e39a5aa77037p+1,
    -0x1.5c66cef0731fep+1};

inline constexpr double kStatLHigh[49] = {
    -0x1.9c0f5c28f5c29p+6, -0x1.92083126e978dp+6, -0x1.87fef9db22d0ep+6, -0x1.7dfef9db22d0ep+6,
    -0x1.73f9db22d0e56p+6, -0x1.6a020c49ba5e3p+6, -0x1.600a3d70a3d71p+6, -0x1.5609374bc6a7fp+6,
    -0x1.4c04189374bc7p+6, -0x1.4209374bc6a7fp+6, -0x1.37fef9db22d0ep+6, -0x1.2e0c49ba5e354p+6,
    -0x1.2400000000000p+6, -0x1.1a0b439581062p+6, -0x1.100b439581062p+6, -0x1.06072b020c49cp+6,
    -0x1.f7f9db22d0e56p+5, -0x1.e3f9db22d0e56p+5, -0x1.d00624dd2f1aap+5, -0x1.bc126e978d4fep+5,
    -0x1.a7fdf3b645a1dp+5, -0x1.941eb851eb852p+5, -0x1.8000000000000p+5, -0x1.6c126e978d4fep+5,
    -0x1.58020c49ba5e3p+5, -0x1.43fdf3b645a1dp+5, -0x1.3004189374bc7p+5, -0x1.1bf3b645a1cacp+5,
    -0x1.0800000000000p+5, -0x1.e845a1cac0831p+4, -0x1.c0189374bc6a8p+4, -0x1.9849ba5e353f8p+4,
    -0x1.7010624dd2f1bp+4, -0x1.4810624dd2f1bp+4, -0x1.1fe353f7ced91p+4, -0x1.efef9db22d0e5p+3,
    -0x1.a03126e978d50p+3, -0x1.506a7ef9db22dp+3, -0x1.0000000000000p+3, -0x1.5fced916872b0p+2,
    -0x1.8083126e978d5p+1, -0x1.083126e978d50p-1, 0x1.ff7ced916872bp+0,  0x1.1fef9db22d0e5p+2,
    0x1.bfced916872b0p+2,  0x1.2fe76c8b43958p+3,  0x1.8020c49ba5e35p+3,  0x1.cfbe76c8b4396p+3,
    0x1.10083126e978dp+4};

inline constexpr double kStatLogEdHigh[49] = {
    -0x1.2905022c3644ep+3, -0x1.1ff10c2fd0905p+3, -0x1.167dd8933b28ap+3, -0x1.0d4e8774a3d27p+3,
    -0x1.043f88e15aad3p+3, -0x1.f60eb142695dep+2, -0x1.e4098f13f7f19p+2, -0x1.d203c6d7b5c1bp+2,
    -0x1.c01438dbf31efp+2, -0x1.ad1d5140aafa0p+2, -0x1.9ab87bcf4f2e3p+2, -0x1.889748c592ff9p+2,
    -0x1.7756ea56810dap+2, -0x1.6539c568e1635p+2, -0x1.5382ff0af8e95p+2, -0x1.42a518eb77b78p+2,
    -0x1.31284d8f49400p+2, -0x1.20be4b496b949p+2, -0x1.10808e85e1812p+2, -0x1.010eb18200757p+2,
    -0x1.e4fffcc6853cdp+1, -0x1.c82bd3fe8c0b4p+1, -0x1.ad73dafefe3a7p+1, -0x1.96f2fb66faa0ep+1,
    -0x1.8016710d9643cp+1, -0x1.6e9796dc66525p+1, -0x1.5dd3b42176ee3p+1, -0x1.5075b6c731cf5p+1,
    -0x1.44515d50c3018p+1, -0x1.399c0e130dd10p+1, -0x1.32f43af0c649bp+1, -0x1.2ab1ad9c8de3fp+1,
    -0x1.2739d29a079cfp+1, -0x1.2305eec750c42p+1, -0x1.1f38f953c14a8p+1, -0x1.1d831f1d6724cp+1,
    -0x1.1b8ff78c82d54p+1, -0x1.1a19733e84da2p+1, -0x1.18d3db2264bfep+1, -0x1.17fa2cfd20c7ep+1,
    -0x1.177d0fb390972p+1, -0x1.1689d5c678a12p+1, -0x1.17a8dc02b580cp+1, -0x1.17ab795ef4d2bp+1,
    -0x1.17b1a8c91e5c5p+1, -0x1.15af83491987fp+1, -0x1.166bc9f1397dfp+1, -0x1.168b2f8a2bf29p+1,
    -0x1.16a51ff7570f4p+1};

inline constexpr double kStatLogEfHigh[49] = {
    -0x1.398f874352f24p+3, -0x1.304c05d9656f3p+3, -0x1.27248472c31c3p+3, -0x1.1de4eec7ffb45p+3,
    -0x1.14ed3cb910da5p+3, -0x1.0b7c395cb3926p+3, -0x1.02861cfb47da9p+3, -0x1.f2d9534373298p+2,
    -0x1.e0a822353bee1p+2, -0x1.ce41fb2ce5ac3p+2, -0x1.bbf0142c6710ap+2, -0x1.a9c336a62bc3fp+2,
    -0x1.97f552dc6c5cap+2, -0x1.862e404486ea2p+2, -0x1.74913ce5cf5f4p+2, -0x1.638d89d5575d8p+2,
    -0x1.5200458e86361p+2, -0x1.4197ea4a31b49p+2, -0x1.314487b2608a8p+2, -0x1.21e0c50ed43a6p+2,
    -0x1.12f0ab4c6bcd2p+2, -0x1.0516f4b694de6p+2, -0x1.efdaf566243c3p+1, -0x1.d84040a56cd87p+1,
    -0x1.c1ebd861b8e7ap+1, -0x1.b016d9b21b8cep+1, -0x1.9f298d91b7628p+1, -0x1.9243cf697707ep+1,
    -0x1.8617668146265p+1, -0x1.7c8cdb9000223p+1, -0x1.74c6c75fb93c3p+1, -0x1.6d86227f31adbp+1,
    -0x1.6915c7cd80989p+1, -0x1.653150541629ep+1, -0x1.623a913d41afbp+1, -0x1.60068ab563101p+1,
    -0x1.5ead508400775p+1, -0x1.5cf1ef1c5ce2ap+1, -0x1.5b93b5599f5e6p+1, -0x1.5b10ab74a57abp+1,
    -0x1.5a6a6721e22f2p+1, -0x1.59f63caa86f89p+1, -0x1.5a36eefe036d0p+1, -0x1.595697d349a8cp+1,
    -0x1.59b7568c93568p+1, -0x1.5906b453148f6p+1, -0x1.5915661510b43p+1, -0x1.59220d97c6b94p+1,
    -0x1.59621cc3acf36p+1};

// Feature slots: the Low / Mid column order; High takes the columns kHighColumns of it.
enum Feature : std::uint32_t {
  kLq,
  kDd10,
  kDd40,
  kDd150,
  kRise2,
  kRise4,
  kRiseNext,
  kSpread,
  kLqf,
  kSharpPrev,
  kSharpNext,
  kDtCand,
  kLqCand,
  kDtEvent,
  kLqEvent,
  kDtStronger,
  kLqMax40,
  kSRel40,
  kNCand1s,
  kOqA,
  kOqB,
  kLaDb2,
  kLaS2,
  kLaOq2,
  kLaDb3,
  kLaS3,
  kLaOq3,
  kLf90,
  kDbr,
  kSrc,
  kFsharpPrev,
  kFsharpNext,
  kFRel40,
  kZs,
  kZf,
  kZscale,
  kFeatureSlots
};
inline constexpr std::uint32_t kHighColumns[30] = {0,  1,  2,  3,  4,  5,  6,  7,  8,  9,
                                                   10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
                                                   20, 27, 28, 29, 30, 31, 32, 33, 34, 35};

// Rate rule filters: scipy resample_poly(up, down) with the reference anti-image filter
// firwin(taps, cutoff, window ('kaiser', kRateFilterBeta)) times up, cutoff as a fraction of the
// upsampled Nyquist rate; taps and beta from kaiserord(120 dB, transition), passband to 20000 Hz
// (scaled by rate / 44100 below 44.1 kHz). Every phase holds fewer than 128 taps.
struct RateFilter {
  std::uint32_t rate, target, up, down, taps;
  double cutoff;
};
inline constexpr double kRateFilterBeta = 0x1.887d028a1dfb9p+3;

inline constexpr RateFilter kRateFilters[11] = {
    {8000u, 48000u, 6u, 1u, 505u, 0x1.5555555555555p-3},
    {11025u, 48000u, 640u, 147u, 53727u, 0x1.999999999999ap-10},
    {16000u, 48000u, 3u, 1u, 253u, 0x1.5555555555555p-2},
    {22050u, 48000u, 320u, 147u, 26865u, 0x1.999999999999ap-9},
    {24000u, 48000u, 2u, 1u, 169u, 0x1.0000000000000p-1},
    {32000u, 48000u, 3u, 2u, 253u, 0x1.5555555555555p-2},
    {44100u, 48000u, 160u, 147u, 13433u, 0x1.999999999999ap-8},
    {88200u, 96000u, 160u, 147u, 2287u, 0x1.999999999999ap-8},
    {176400u, 192000u, 160u, 147u, 1617u, 0x1.999999999999ap-8},
    {352800u, 192000u, 80u, 147u, 1451u, 0x1.bdd2b899406f7p-8},
    {384000u, 192000u, 1u, 2u, 21u, 0x1.0000000000000p-1}};
} // namespace effetune::plugins::analyzer::rhythm_d
