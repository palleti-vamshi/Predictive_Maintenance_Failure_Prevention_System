"""Command-Line Interface for Predictive Maintenance ML Service.

Example invocation:
  python cli.py train \
    --csv-path /path/to/dataset.csv \
    --model-type random_forest \
    --config '{"column_mappings": [...]}' \
    --output-dir /path/to/artifacts
"""

import sys
import os
import argparse
import json

# Ensure services/ml-service is in sys.path
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

from pipeline import run_pipeline


def main():
    parser = argparse.ArgumentParser(description="Mechanical Predictive Maintenance ML Runner")
    subparsers = parser.add_subparsers(dest="command", required=True)

    train_parser = subparsers.add_parser("train", help="Train and evaluate ML model on dataset")
    train_parser.add_argument("--csv-path", required=True, help="Path to input dataset CSV")
    train_parser.add_argument("--model-type", required=True, choices=["random_forest", "isolation_forest"], help="Model architecture")
    train_parser.add_argument("--config", default="{}", help="JSON string or path to JSON configuration")
    train_parser.add_argument("--output-dir", required=True, help="Directory to store model.joblib and results.json")

    args = parser.parse_args()

    if args.command == "train":
        # Parse config
        config = {}
        if args.config.startswith("{"):
            config = json.loads(args.config)
        elif os.path.exists(args.config):
            with open(args.config, "r", encoding="utf-8") as f:
                config = json.load(f)

        column_mappings = config.get("column_mappings", [])
        window_size = int(config.get("window_size", 256))
        overlap_ratio = float(config.get("overlap_ratio", 0.5))
        sampling_rate_hz = config.get("sampling_rate_hz")
        shaft_speed_rpm = config.get("shaft_speed_rpm")
        pinion_teeth = config.get("pinion_teeth")
        random_state = int(config.get("random_state", 42))

        try:
            results = run_pipeline(
                csv_path=args.csv_path,
                model_type=args.model_type,
                column_mappings=column_mappings,
                output_dir=args.output_dir,
                window_size=window_size,
                overlap_ratio=overlap_ratio,
                sampling_rate_hz=sampling_rate_hz,
                shaft_speed_rpm=shaft_speed_rpm,
                pinion_teeth=pinion_teeth,
                random_state=random_state
            )
            # Output clean JSON on stdout for Node.js caller
            print(json.dumps({"success": True, "data": results}))
            sys.exit(0)
        except Exception as e:
            err_output = {
                "success": False,
                "error": type(e).__name__,
                "message": str(e)
            }
            print(json.dumps(err_output), file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    main()

