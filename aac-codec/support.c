#include "libavcodec/aacenc.h"
#include "libavutil/channel_layout.h"
#include "libavcodec/avcodec.h"
#include <libavutil/samplefmt.h>
#include <stdbool.h>
#include <stdlib.h>

typedef struct AACEncoder {
    AVCodecContext *ctx;
    AVFrame *frame;
    AVPacket *packet;
    int64_t pts;
    int frame_size;
    int channels;
} AACEncoder;


void aac_encoder_destroy(AACEncoder *enc);

// Create and initialize an AAC encoder
AACEncoder* aac_encoder_create(int bit_rate, int channel_count, int sample_rate) {
    AACEncoder *enc = calloc(1, sizeof(AACEncoder));
    if (!enc) return NULL;

    const AVCodec *codec = avcodec_find_encoder(AV_CODEC_ID_AAC);
    if (!codec) goto fail;

    enc->ctx = avcodec_alloc_context3(codec);
    if (!enc->ctx) goto fail;

    // Configure context
    enc->ctx->bit_rate = bit_rate;
    enc->ctx->sample_rate = sample_rate;
    enc->ctx->sample_fmt = AV_SAMPLE_FMT_FLTP;
    enc->ctx->strict_std_compliance = FF_COMPLIANCE_EXPERIMENTAL;
    enc->ctx->profile = AV_PROFILE_AAC_LOW;

    AACEncContext* aac_ctx = (AACEncContext*)(enc->ctx->priv_data);
    // Use fast coder (smaller code size than twoloop)
    aac_ctx->options.coder = AAC_CODER_FAST;

    // Set channel layout (stereo for 2, mono for 1, etc.)
    av_channel_layout_default(&enc->ctx->ch_layout, channel_count);

    // Some containers need global headers
    enc->ctx->flags |= AV_CODEC_FLAG_GLOBAL_HEADER;

    int ret = avcodec_open2(enc->ctx, codec, NULL);
    if (ret < 0) goto fail;

    enc->frame_size = enc->ctx->frame_size;
    enc->channels = channel_count;

    // Create reusable input frame
    enc->frame = av_frame_alloc();
    if (!enc->frame) goto fail;

    enc->frame->nb_samples = enc->frame_size;
    enc->frame->format = AV_SAMPLE_FMT_FLTP;
    enc->frame->sample_rate = sample_rate;
    av_channel_layout_copy(&enc->frame->ch_layout, &enc->ctx->ch_layout);

    if (av_frame_get_buffer(enc->frame, 0) < 0) goto fail;

    // Create reusable output packet
    enc->packet = av_packet_alloc();
    if (!enc->packet) goto fail;

    enc->pts = 0;
    return enc;

fail:
    aac_encoder_destroy(enc);
    return NULL;
}

void aac_encoder_destroy(AACEncoder *enc) {
    if (!enc) return;
    if (enc->ctx) avcodec_free_context(&enc->ctx);
    if (enc->frame) av_frame_free(&enc->frame);
    if (enc->packet) av_packet_free(&enc->packet);
    free(enc);
}

// Get the required frame size (1024 for AAC)
int aac_encoder_get_frame_size(AACEncoder *enc) {
    return enc->frame_size;
}

// Get pointer to write samples for a specific channel.
// Ensures the frame is writable before returning the pointer.
float* aac_encoder_get_frame_ptrs(AACEncoder *enc) {
    if (av_frame_make_writable(enc->frame) < 0) return NULL;
    return (float*)enc->frame->data;
}

// Internal: send the current frame to the encoder
static int send_frame(AACEncoder *enc, int nb_samples) {
    enc->frame->nb_samples = nb_samples;
    enc->frame->pts = enc->pts;
    enc->pts += nb_samples;
    return avcodec_send_frame(enc->ctx, enc->frame);
}

// Try to receive an encoded packet from the encoder.
// Call this in a loop until it returns 0 to drain all available packets.
// Returns:
//   1 = packet available (call aac_encoder_get_packet_* to retrieve it,
//       then aac_encoder_packet_consumed before calling this again)
//   0 = no packet available (need more input or finished)
//  -1 = error
int aac_encoder_receive_packet(AACEncoder *enc) {
    int ret = avcodec_receive_packet(enc->ctx, enc->packet);
    if (ret == 0) {
        return 1; // Packet available
    } else if (ret == AVERROR(EAGAIN) || ret == AVERROR_EOF) {
        return 0; // Need more input or finished
    }
    return -1; // Error
}

// Send a complete frame (frame_size samples) to the encoder.
// The frame data must already be in the frame buffer.
// After calling, drain packets with aac_encoder_receive_packet.
int aac_encoder_send_frame(AACEncoder *enc) {
    int ret = send_frame(enc, enc->frame_size);
    if (ret < 0 && ret != AVERROR(EAGAIN)) {
        return ret;
    }
    return 0;
}

// Begin flushing the encoder. Call this after all samples have been processed.
// leftover_samples: number of samples remaining in the frame buffer (0 if none)
// After calling this, call aac_encoder_receive_packet in a loop until it returns 0.
// Returns:
//   0 = flush initiated successfully
//  -1 = error
int aac_encoder_begin_flush(AACEncoder *enc, int leftover_samples) {
    // Send any remaining samples as a partial frame
    if (leftover_samples > 0) {
        int ret = send_frame(enc, leftover_samples);
        if (ret < 0 && ret != AVERROR(EAGAIN)) {
            return ret;
        }
    }

    // Signal EOF to encoder
    avcodec_send_frame(enc->ctx, NULL);
    return 0;
}

// Get encoded packet data (valid after aac_encoder_receive_packet returns 1)
uint8_t* aac_encoder_get_packet_data(AACEncoder *enc) {
    return enc->packet->data;
}

int aac_encoder_get_packet_size(AACEncoder *enc) {
    return enc->packet->size;
}

// Get packet PTS in seconds (converts from time_base units)
double aac_encoder_get_packet_pts_seconds(AACEncoder *enc) {
    AVRational tb = enc->ctx->time_base;
    return (double)enc->packet->pts * tb.num / tb.den;
}

// Get packet duration in seconds (converts from time_base units)
double aac_encoder_get_packet_duration_seconds(AACEncoder *enc) {
    AVRational tb = enc->ctx->time_base;
    return (double)enc->packet->duration * tb.num / tb.den;
}

// Call after processing the packet to allow the next encode call
void aac_encoder_packet_consumed(AACEncoder *enc) {
    av_packet_unref(enc->packet);
}

// Get codec extradata (AudioSpecificConfig for AAC, needed for MP4/ADTS)
uint8_t* aac_encoder_get_extradata(AACEncoder *enc) {
    return enc->ctx->extradata;
}

int aac_encoder_get_extradata_size(AACEncoder *enc) {
    return enc->ctx->extradata_size;
}
