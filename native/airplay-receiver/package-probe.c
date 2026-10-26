#include <gst/app/gstappsink.h>
#include <gst/app/gstappsrc.h>
#include <gst/gst.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

int main(int argc, char **argv) {
    const char *required[] = {"appsrc", "queue", "avdec_aac", "avdec_alac",
                             "audioconvert", "audioresample", "volume",
                             "rtpL16pay", "udpsink", NULL};
    gst_init(&argc, &argv);
    const gboolean rtp_output = argc == 3 && strcmp(argv[1], "--rtp-output") == 0;
    FILE *rtp_file = rtp_output ? fopen(argv[2], "wb") : NULL;
    if (rtp_output && !rtp_file) return 1;
    for (unsigned i = 0; required[i]; ++i) {
        GstElementFactory *factory = gst_element_factory_find(required[i]);
        if (!factory) {
            fprintf(stderr, "Missing AirPlay audio element: %s\n", required[i]);
            return 1;
        }
        gst_object_unref(factory);
    }

    GError *error = NULL;
    gchar *description = g_strconcat(
        "appsrc name=input format=time ! "
        "audio/x-raw,format=S16LE,rate=44100,channels=2,layout=interleaved ! "
        "avenc_alac ! avdec_alac ! audioconvert dithering=0 noise-shaping=0 ! "
        "audio/x-raw,format=S16BE,rate=44100,channels=2 ! ",
        rtp_output ? "rtpL16pay pt=96 mtu=1400 ! " : "",
        "appsink name=output sync=false", NULL);
    GstElement *pipeline = gst_parse_launch(description, &error);
    g_free(description);
    if (!pipeline || error) {
        fprintf(stderr, "Audio probe pipeline failed: %s\n", error ? error->message : "unknown");
        if (error) g_error_free(error);
        if (pipeline) gst_object_unref(pipeline);
        return 1;
    }
    GstElement *input = gst_bin_get_by_name(GST_BIN(pipeline), "input");
    GstElement *output = gst_bin_get_by_name(GST_BIN(pipeline), "output");
    GstBuffer *buffer = gst_buffer_new_allocate(NULL, 8192 * 4, NULL);
    GstMapInfo map;
    gst_buffer_map(buffer, &map, GST_MAP_WRITE);
    for (unsigned frame = 0; frame < 8192; ++frame) {
        int16_t value = (int16_t)((frame % 511) * 32 - 8160);
        map.data[frame * 4] = (uint8_t)value;
        map.data[frame * 4 + 1] = (uint8_t)((uint16_t)value >> 8);
        value = (int16_t)-value;
        map.data[frame * 4 + 2] = (uint8_t)value;
        map.data[frame * 4 + 3] = (uint8_t)((uint16_t)value >> 8);
    }
    gst_buffer_unmap(buffer, &map);
    GST_BUFFER_PTS(buffer) = 0;
    GST_BUFFER_DURATION(buffer) = gst_util_uint64_scale(8192, GST_SECOND, 44100);
    gst_element_set_state(pipeline, GST_STATE_PLAYING);
    gst_app_src_push_buffer(GST_APP_SRC(input), buffer);
    gst_app_src_end_of_stream(GST_APP_SRC(input));

    unsigned frames = 0;
    gboolean valid = TRUE;
    while (!gst_app_sink_is_eos(GST_APP_SINK(output))) {
        GstSample *sample = gst_app_sink_try_pull_sample(GST_APP_SINK(output), 5 * GST_SECOND);
        if (!sample) {
            valid = gst_app_sink_is_eos(GST_APP_SINK(output));
            break;
        }
        GstBuffer *decoded = gst_sample_get_buffer(sample);
        gst_buffer_map(decoded, &map, GST_MAP_READ);
        size_t payload_offset = 0;
        if (rtp_output) {
            if (map.size < 12 || map.data[0] != 0x80 || (map.data[1] & 127) != 96) {
                valid = FALSE;
            } else {
                uint32_t size = (uint32_t)map.size;
                uint8_t length[4] = {(uint8_t)size, (uint8_t)(size >> 8),
                                     (uint8_t)(size >> 16), (uint8_t)(size >> 24)};
                if (fwrite(length, 1, 4, rtp_file) != 4 ||
                    fwrite(map.data, 1, map.size, rtp_file) != map.size) valid = FALSE;
                payload_offset = 12;
            }
        }
        if ((map.size - payload_offset) % 4 != 0) valid = FALSE;
        for (size_t offset = payload_offset; valid && offset + 4 <= map.size; offset += 4, ++frames) {
            int16_t left = (int16_t)(((uint16_t)map.data[offset] << 8) | map.data[offset + 1]);
            int16_t right = (int16_t)(((uint16_t)map.data[offset + 2] << 8) | map.data[offset + 3]);
            int16_t expected = (int16_t)((frames % 511) * 32 - 8160);
            if (left != expected || right != -expected) {
                fprintf(stderr, "Frame %u: received %d/%d, expected %d/%d\n", frames,
                        left, right, expected, -expected);
                valid = FALSE;
            }
        }
        gst_buffer_unmap(decoded, &map);
        gst_sample_unref(sample);
        if (!valid) break;
    }
    gst_element_set_state(pipeline, GST_STATE_NULL);
    gst_object_unref(input);
    gst_object_unref(output);
    gst_object_unref(pipeline);
    gst_deinit();
    if (rtp_file) fclose(rtp_file);
    if (!valid || frames != 8192) {
        fprintf(stderr, "ALAC stereo roundtrip failed after %u frames\n", frames);
        return 1;
    }
    puts("AirPlay package audio probe passed: 8192 exact stereo S16BE frames");
    return 0;
}
