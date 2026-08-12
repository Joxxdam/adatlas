import AppKit
import Foundation
import Vision

struct Box: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct TextLine: Codable {
    let text: String
    let confidence: Double
    let box: Box
}

struct Face: Codable {
    let confidence: Double
    let box: Box
}

struct Output: Codable {
    let lines: [TextLine]
    let faces: [Face]
}

func topLeftBox(_ rect: CGRect) -> Box {
    return Box(
        x: max(0, min(1, rect.origin.x)),
        y: max(0, min(1, 1 - rect.origin.y - rect.height)),
        width: max(0, min(1, rect.width)),
        height: max(0, min(1, rect.height))
    )
}

guard CommandLine.arguments.count >= 2 else {
    fputs("Usage: review-ocr.swift <image-path>\n", stderr)
    exit(2)
}

let imagePath = CommandLine.arguments[1]
guard let image = NSImage(contentsOfFile: imagePath),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    fputs("Unable to decode image\n", stderr)
    exit(3)
}

let textRequest = VNRecognizeTextRequest()
textRequest.recognitionLevel = .accurate
textRequest.recognitionLanguages = ["ko-KR", "en-US"]
textRequest.usesLanguageCorrection = true
textRequest.minimumTextHeight = 0.008

let faceRequest = VNDetectFaceRectanglesRequest()
let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

do {
    try handler.perform([textRequest, faceRequest])
    let lines = (textRequest.results ?? []).compactMap { observation -> TextLine? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        return TextLine(
            text: candidate.string,
            confidence: Double(candidate.confidence),
            box: topLeftBox(observation.boundingBox)
        )
    }.sorted { left, right in
        if abs(left.box.y - right.box.y) > 0.015 { return left.box.y < right.box.y }
        return left.box.x < right.box.x
    }
    let faces = (faceRequest.results ?? []).map { observation in
        Face(confidence: Double(observation.confidence), box: topLeftBox(observation.boundingBox))
    }
    let data = try JSONEncoder().encode(Output(lines: lines, faces: faces))
    FileHandle.standardOutput.write(data)
} catch {
    fputs("Vision analysis failed: \(error.localizedDescription)\n", stderr)
    exit(4)
}
