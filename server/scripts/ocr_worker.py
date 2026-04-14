import sys
import json
import base64
import os
import re
import mimetypes
from typing import Any, Dict, List, Optional, Tuple

from openai import OpenAI
from PIL import Image


def print_json(payload: Dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False))


def detect_mime_type(image_path: str, img: Image.Image) -> str:
    """
    Определяет MIME-тип изображения.
    Сначала пытается взять формат из PIL, затем fallback по расширению файла.
    """
    pil_format = (img.format or "").upper()

    if pil_format == "PNG":
        return "image/png"
    if pil_format in ("JPG", "JPEG"):
        return "image/jpeg"
    if pil_format == "WEBP":
        return "image/webp"

    guessed, _ = mimetypes.guess_type(image_path)
    if guessed in {"image/png", "image/jpeg", "image/webp"}:
        return guessed

    return "image/png"


def normalize_text(text: str) -> str:
    """
    Нормализует текст поиска.
    """
    return " ".join(text.strip().split())


def coerce_response_content(content: Any) -> str:
    """
    Приводит content ответа модели к строке.
    Иногда API/SDK могут вернуть нестроковую структуру.
    """
    if content is None:
        return ""

    if isinstance(content, str):
        return content

    if isinstance(content, list):
        parts: List[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                if "text" in item and isinstance(item["text"], str):
                    parts.append(item["text"])
                else:
                    parts.append(str(item))
            else:
                parts.append(str(item))
        return "\n".join(parts)

    return str(content)


def parse_bboxes(raw_text: str) -> List[Tuple[float, float, float, float]]:
    """
    Ищет ВСЕ bounding boxes формата [[x1,y1,x2,y2]].
    Поддерживает пробелы и целые/дробные числа.
    """
    pattern = re.compile(
        r"\[\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]\]"
    )

    matches = pattern.findall(raw_text)
    results: List[Tuple[float, float, float, float]] = []

    for match in matches:
        try:
            x1, y1, x2, y2 = map(float, match)
            results.append((x1, y1, x2, y2))
        except ValueError:
            continue

    return results


def clamp_bbox_to_image(
    bbox_0_1000: Tuple[float, float, float, float],
    width: int,
    height: int
) -> List[float]:
    """
    Конвертирует координаты из шкалы 0..1000 в пиксели изображения
    и ограничивает значениями границ изображения.
    """
    x1_raw, y1_raw, x2_raw, y2_raw = bbox_0_1000

    x1 = max(0.0, min(float(width), x1_raw * width / 1000.0))
    y1 = max(0.0, min(float(height), y1_raw * height / 1000.0))
    x2 = max(0.0, min(float(width), x2_raw * width / 1000.0))
    y2 = max(0.0, min(float(height), y2_raw * height / 1000.0))

    left = min(x1, x2)
    top = min(y1, y2)
    right = max(x1, x2)
    bottom = max(y1, y2)

    return [left, top, right, bottom]


def bbox_center(bbox_px: List[float]) -> Dict[str, float]:
    left, top, right, bottom = bbox_px
    return {
        "x": round((left + right) / 2.0, 2),
        "y": round((top + bottom) / 2.0, 2),
    }


def estimate_confidence(raw_output: str, match_count: int) -> Optional[float]:
    """
    Простая эвристика уверенности.
    Это НЕ confidence от модели, а техническая оценка полезности ответа.
    """
    if match_count <= 0:
        return None

    lowered = raw_output.lower()

    if match_count == 1 and "not_found" not in lowered and len(raw_output) < 400:
        return 0.8

    if match_count > 1:
        return 0.45

    return 0.6


def build_prompt(target_text: str) -> str:
    """
    Промпт для DeepSeek-OCR-2
    """    norm = target_text.lower().strip()
    if norm in ["все", "все", "all", "everything", "*", ""] or "все" in norm:
        return "Extract all text from the image and return it as markdown. Preserve the layout and tables if possible."
    
    return (
        f'<|grounding|>Please find the exact location of "{target_text}" '
        f'and return its bounding box as [[x1,y1,x2,y2]]. '
        'If the text is not present, return "NOT_FOUND".'
    )


def build_error(
    error_code: str,
    message: str,
    raw_output: Optional[str] = None
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "success": False,
        "error_code": error_code,
        "error": message,
    }
    if raw_output is not None:
        payload["raw_output"] = raw_output
    return payload


def ocr_process(image_path: str, target_text: str) -> None:
    """
    Интеграция DeepSeek-OCR-2 для визуального поиска текста на скриншоте.
    Возвращает JSON в stdout.
    """
    try:
        api_key = os.environ.get("API_KEY") or os.environ.get("CLOUDRU_FM_API_KEY")
        if not api_key:
            print_json(build_error(
                "MISSING_API_KEY",
                "Neither API_KEY nor CLOUDRU_FM_API_KEY environment variable is set"
            ))
            return

        if not os.path.exists(image_path):
            print_json(build_error(
                "IMAGE_NOT_FOUND",
                f"Image file not found: {image_path}"
            ))
            return

        normalized_target = normalize_text(target_text)
        if not normalized_target:
            print_json(build_error(
                "EMPTY_TARGET_TEXT",
                "Target text is empty after normalization"
            ))
            return

        with Image.open(image_path) as img:
  
            max_size = 3072
            if max(img.size) > max_size:
                ratio = max_size / float(max(img.size))
                new_size = (int(img.size[0] * ratio), int(img.size[1] * ratio))
                img = img.resize(new_size, Image.Resampling.LANCZOS)
            
            width, height = img.size
            
            from io import BytesIO
            buffered = BytesIO()

            if img.mode in ("RGBA", "P", "LA"):
                background = Image.new("RGB", img.size, (255, 255, 255))
                if img.mode == "P":
                    img = img.convert("RGBA")
                mask = img.split()[-1] if img.mode == "RGBA" else None
                background.paste(img, mask=mask)
                img = background
            elif img.mode != "RGB":
                img = img.convert("RGB")

            img.save(buffered, format="JPEG", quality=95)
            base64_image = base64.b64encode(buffered.getvalue()).decode("utf-8")
            mime_type = "image/jpeg"

        prompt = build_prompt(normalized_target)
        
        payload = {
            "model": "deepseek-ai/DeepSeek-OCR-2",
            "max_tokens": 2500,
            "temperature": 0.5,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{mime_type};base64,{base64_image}"
                            }
                        }
                    ]
                }
            ]
        }

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        import httpx
        import time
        
        data = None
        last_error = ""
        max_retries = 3
        
        for attempt in range(max_retries):
            try:
                sys.stderr.write(f"[DEBUG OCR] Attempt {attempt+1} starting API call. Model: deepseek-ai/DeepSeek-OCR-2, Prompt: '{prompt}', Image: {width}x{height}, Payload: {len(base64_image)} chars\n")

                with httpx.Client(timeout=120.0) as client:
                    response = client.post(
                        "https://foundation-models.api.cloud.ru/v1/chat/completions",
                        json=payload,
                        headers=headers
                    )
                    
                    if response.status_code == 200:
                        data = response.json()
                        break
                    
                    last_error = f"HTTP {response.status_code}: {response.text}"
                    sys.stderr.write(f"[DEBUG OCR] Attempt {attempt+1} failed: {last_error}\n")
                    
              
                    if response.status_code < 500 and response.status_code != 429:
                        break
                        
            except Exception as e:
                last_error = str(e)
                sys.stderr.write(f"[DEBUG OCR] Attempt {attempt+1} exception: {last_error}\n")
            
            if attempt < max_retries - 1:
                sleep_time = 3 * (attempt + 1)
                time.sleep(sleep_time)

        if not data:
            print_json(build_error(
                "API_ERROR",
                f"Cloud.ru API failed after {max_retries} attempts. This usually means a rate limit or service outage. Last error: {last_error}",
                raw_output=last_error
            ))
            return

        if not data.get("choices"):
            print_json(build_error(
                "EMPTY_RESPONSE",
                "Model returned no choices",
                raw_output=str(data)
            ))
            return

        raw_content = coerce_response_content(data["choices"][0]["message"]["content"]).strip()

        if not raw_content:
            print_json(build_error(
                "EMPTY_CONTENT",
                "Model returned empty content"
            ))
            return

        if "NOT_FOUND" in raw_content.upper():
            print_json(build_error(
                "NOT_FOUND",
                f"Text '{normalized_target}' was not found by OCR model",
                raw_output=raw_content
            ))
            return

        all_text_keywords = ["все", "all", "everything", "*"]
        is_all_text = (
            not normalized_target or 
            normalized_target.lower() in all_text_keywords or
            (len(normalized_target) == 3 and not any(c.isalnum() for c in normalized_target))
        )
        
        matches = parse_bboxes(raw_content)
        cleaned_text = re.sub(r'(?:text)?\[\[.*?\]\]', '', raw_content).strip()
        if not cleaned_text:
            cleaned_text = raw_content

        if is_all_text:
            detections = []
            for idx, bbox_0_1000 in enumerate(matches):
                bbox_px = clamp_bbox_to_image(bbox_0_1000, width, height)
                detections.append({
                    "text": cleaned_text,
                    "bbox": [round(float(v), 2) for v in bbox_px],
                    "center": bbox_center(bbox_px),
                    "confidence": estimate_confidence(raw_content, len(matches)),
                    "match_index": idx,
                    "raw_bbox_0_1000": [round(float(v), 3) for v in bbox_0_1000],
                })

            result = {
                "success": True,
                "text": cleaned_text,
                "raw_output": raw_content,
                "match_count": len(matches),
                "image_size": {
                    "width": width,
                    "height": height,
                    "mime_type": mime_type,
                },
                "detections": detections
            }
            print_json(result)
            return

        if not matches:
            print_json(build_error(
                "BAD_RESPONSE_FORMAT",
                f"Could not parse bounding box for text '{normalized_target}'",
                raw_output=raw_content
            ))
            return

        detections: List[Dict[str, Any]] = []
        for idx, bbox_0_1000 in enumerate(matches):
            bbox_px = clamp_bbox_to_image(bbox_0_1000, width, height)
            detections.append({
                "text": normalized_target,
                "bbox": [round(v, 2) for v in bbox_px],
                "center": bbox_center(bbox_px),
                "confidence": estimate_confidence(raw_content, len(matches)),
                "match_index": idx,
                "raw_bbox_0_1000": [round(v, 3) for v in bbox_0_1000],
            })

        result = {
            "success": True,
            "error_code": None,
            "target_text": normalized_target,
            "match_count": len(detections),
            "image_size": {
                "width": width,
                "height": height,
                "mime_type": mime_type,
            },
            "detections": detections,
            "raw_output": raw_content,
        }

        print_json(result)

    except Exception as e:
        import traceback
        print_json(build_error(
            "UNHANDLED_EXCEPTION",
            f"{str(e)}\n{traceback.format_exc()}"
        ))


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print_json(build_error(
            "INVALID_ARGS",
            "Usage: py ocr-wrapper.py <image_path> <target_text>"
        ))
    else:
        ocr_process(sys.argv[1], sys.argv[2])
